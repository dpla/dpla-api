import * as express from "express";

import fetch from "node-fetch";
import { Request, Response, Headers } from "node-fetch";
import { ApiResponse, Client } from "@elastic/elasticsearch";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import {
  S3Client,
  HeadObjectCommand,
  HeadObjectOutput,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const LONG_CACHE_TIME: number = 60 * 60 * 24 * 30; //seconds
const SHORT_CACHE_TIME = 60; //seconds
const IMAGE_REQUEST_TIMEOUT = 10000; //ms

const PATH_PATTERN = /^\/thumb\/([a-f0-9]{32})$/;
const URL_PATTERN = /^https?:\/\//;

export default class ThumbnailController {
  bucket: string;
  s3: S3Client;
  sqs: SQSClient;
  esClient: Client;

  constructor(bucket: string, s3: S3Client, sqs: SQSClient, esClient: Client) {
    this.bucket = bucket;
    this.s3 = s3;
    this.sqs = sqs;
    this.esClient = esClient;
  }

  //todo refactor to non-express api
  async handle(req: express.Request, res: express.Response): Promise<void> {
    const itemId: string | null = this.getItemId(req.path) as string;

    if (!itemId) {
      this.sendError(res, itemId, 400, "Bad item ID.");
      return;
    }

    try {
      //ask S3 if it has a copy of the image
      await this.lookupImageInS3(itemId);
      //success, get image from s3
      await this.serveItemFromS3(itemId, res);
    } catch (e) {
      //failure, proxy image from contributor, queue cache request

      //if we already started sending a response, we're doomed.
      if (res.writableEnded) {
        console.error(
          `Started sending S3 response for ${itemId} but failed.`,
          e,
        );
        res.end();
      } else {
        try {
          await this.proxyItemFromContributor(itemId, res);
        } catch (error: any) {
          if (!res.headersSent) {
            this.sendError(
              res,
              itemId,
              502,
              error?.message || "Unknown error.",
            );
          }
        }
      }
    }
  }

  sendError(
    res: express.Response,
    itemId: string,
    code: number,
    errorMessage: string,
  ): void {
    console.error(`Sending ${code} for ${itemId}:`, errorMessage);
    res.sendStatus(code);
    res.end();
  }

  async proxyItemFromContributor(
    itemId: string,
    expressResponse: express.Response,
  ): Promise<void> {
    //we only want the cache to have the proxied image from the contributor for a short amount
    //because it won't have been sized down
    expressResponse.set(this.getCacheHeaders(SHORT_CACHE_TIME));

    let esResponse = undefined;

    try {
      esResponse = await this.lookupItemInElasticsearch(itemId);
    } catch (error: any) {
      if (error?.statusCode === 404) {
        this.sendError(
          expressResponse,
          itemId,
          404,
          "Not found in search index.",
        );
        return Promise.reject(error);
      } else {
        // couldn't connect or something
        console.error(`Caught error for ${itemId} from ElasticSearch.`, error);
        this.sendError(expressResponse, itemId, 502, error);
        return Promise.reject(error);
      }
    }

    let imageUrl: string | null = null;

    try {
      imageUrl = await this.getImageUrlFromSearchResult(esResponse);
    } catch (error: any) {
      this.sendError(expressResponse, itemId, 404, error?.message || "Unknown");
      return Promise.reject(error);
    }

    //don't wait on this, it's a side effect to make the image be in S3 next time
    this.queueToThumbnailCache(itemId, imageUrl).catch((error) => {
      console.error(`SQS error for ${itemId}: `, error);
    });

    try {
      let remoteImageResponse: Response | null = null;

      try {
        remoteImageResponse = await this.getRemoteImagePromise(imageUrl);
      } catch (error) {
        this.sendError(
          expressResponse,
          itemId,
          404,
          `Couldn't connect to upstream ${imageUrl}: ${error}`,
        );
        return;
      }

      const status = this.getImageStatusCode(remoteImageResponse.status);

      if (status > 399) {
        this.sendError(
          expressResponse,
          itemId,
          404,
          `Status ${status} from upstream.`,
        );
        return;
      }

      const headers = this.getHeadersFromTarget(remoteImageResponse.headers);

      if (headers.get("Content-Type")) {
        const contentType = headers.get("Content-Type") || "nope";
        if (
          !contentType.startsWith("image") &&
          !contentType.endsWith("octet-stream")
        ) {
          this.sendError(
            expressResponse,
            itemId,
            404,
            `Got bad content type ${contentType} from upstream.`,
          );
          return;
        }
      }

      expressResponse.status(status);
      expressResponse.set(headers);
      if (remoteImageResponse?.body && "pipe" in remoteImageResponse?.body) {
        remoteImageResponse.body.pipe(expressResponse, { end: true });
        console.info(`200 for ${itemId} from contributing institution.`);
      } else {
        this.sendError(
          expressResponse,
          itemId,
          404,
          "Unable to pipe response from upstream.",
        );
      }
    } catch (error: any) {
      this.sendError(
        expressResponse,
        itemId,
        this.getImageStatusCode(error?.statusCode),
        error,
      );
    }
  }

  async serveItemFromS3(
    itemId: string,
    expressResponse: express.Response,
  ): Promise<void> {
    expressResponse.set(this.getCacheHeaders(LONG_CACHE_TIME));
    const s3url = await this.getS3Url(itemId);
    const { body, headers, status }: Response =
      await this.getRemoteImagePromise(s3url);
    expressResponse.status(this.getImageStatusCode(status));
    expressResponse.set(this.getHeadersFromTarget(headers));
    if (body && "pipe" in body) {
      body.pipe(expressResponse, { end: true });
      console.info(`200 for ${itemId} from S3.`);
    } else {
      this.sendError(
        expressResponse,
        itemId,
        404,
        "Unable to pipe response from upstream.",
      );
    }
  }

  //performs a head request against s3. it either works and we grab the data out from s3, or it fails and
  //we get it from the contributor.
  async lookupImageInS3(id: string): Promise<HeadObjectOutput> {
    const params = { Bucket: this.bucket, Key: this.getS3Key(id) };
    return this.s3.send(new HeadObjectCommand(params));
  }

  async getS3Url(id: string): Promise<string> {
    const params = { Bucket: this.bucket, Key: this.getS3Key(id) };
    return getSignedUrl(this.s3, new GetObjectCommand(params));
  }

  async queueToThumbnailCache(id: string, url: string): Promise<void> {
    if (!process.env.SQS_URL) return;
    const msg = JSON.stringify({ id: id, url: url });

    await this.sqs.send(
      new SendMessageCommand({
        MessageBody: msg,
        QueueUrl: process.env.SQS_URL,
      }),
    );
  }

  async lookupItemInElasticsearch(id: string): Promise<ApiResponse> {
    return this.esClient.get({
      id: id,
      index: "dpla_alias",
      _source: ["id", "object"],
    });
  }

  async getImageUrlFromSearchResult(
    record: Record<string, any>,
  ): Promise<string> {
    //using ?. operator short circuits the result in object to "undefined"
    //rather than throwing an exception when the property doesn't exist
    const obj = record?._source?.object;

    let url = "";

    if (obj && Array.isArray(obj)) {
      url = obj[0];
    } else if (obj && typeof obj == "string") {
      url = obj;
    } else {
      return Promise.reject("Couldn't find image URL in record.");
    }

    if (!this.isProbablyURL(url)) {
      return Promise.reject("URL was malformed.");
    } else {
      return Promise.resolve(url);
    }
  }

  //wrapper promise + race that makes requests give up if they take too long
  //in theory could be used for any promise, but we're using it for provider responses.
  async withTimeout<T>(msecs: number, promise: Promise<T>): Promise<T> {
    const timeout = new Promise<T>((resolve, reject) => {
      setTimeout(() => {
        reject(new Error("Response from server timed out."));
      }, msecs);
    });
    return Promise.race([timeout, promise]);
  }

  // -------------- non-async helper functions below --------------

  //item ids are always the same length and have hex characters in them
  //blow up if this isn't one
  getItemId(path: string): string | null {
    const matchResult = PATH_PATTERN.exec(path);
    if (matchResult) {
      return matchResult[1];
    } else {
      return null;
    }
  }

  //the keys in the cache bucket in s3 have subfolders to keep it from being an enormous list
  //the first 4 hex digits in the image id are used to create a path structure like /1/2/3/4
  //weak argument validation here because it should have already been validated by getItemId.
  getS3Key(id: string): string {
    const prefix = id.substring(0, 4).split("").join("/");
    return prefix + "/" + id + ".jpg";
  }

  isProbablyURL(s: string): boolean {
    if (!s) return false;
    if (!URL_PATTERN.test(s)) return false;
    try {
      new URL(s);
    } catch (e) {
      //didn't parse
      return false;
    }
    return true;
  }

  //tells upstream, including CloudFront, how long to keep the image around
  //parameterized because we want provider errors to be cached for a shorter time
  //whereas s3 responses should live there for a long time
  //see LONG_CACHE_TIME and SHORT_CACHE_TIME, above
  getCacheHeaders(seconds: number): Map<string, string> {
    const now = new Date().getTime();
    const expirationDateString = new Date(now + 1000 * seconds).toUTCString();
    const cacheControl = `public, max-age=${seconds}`;
    return new Map([
      ["Cache-Control", cacheControl],
      ["Expires", expirationDateString],
    ]);
  }

  //issues async request for the image (could be s3 or provider)
  getRemoteImagePromise(imageUrl: string): Promise<Response> {
    const request: Request = new Request(imageUrl);
    request.headers.append("User-Agent", "DPLA Image Proxy");
    return this.withTimeout(
      IMAGE_REQUEST_TIMEOUT,
      fetch(request, { redirect: "follow" }),
    );
  }

  //providers/s3 could set all sorts of weird headers, but we only want to pass along a few
  getHeadersFromTarget(headers: Headers): Map<string, string> {
    const result = new Map();

    // Reduce headers to just those that we want to pass through
    const contentType = "Content-Type";
    if (headers.has(contentType)) {
      result.set(contentType, headers.get(contentType));
    }

    const lastModified = "Last-Modified";
    if (headers.has(lastModified)) {
      result.set(lastModified, headers.get(lastModified));
    }

    return result;
  }

  // We have our own ideas of which response codes are appropriate for our client.
  getImageStatusCode(status: number): number {
    switch (status) {
      case 200:
        return 200;
      case 404:
      case 410:
        // We treat a 410 as a 404, because our provider could correct
        // the `object' property in the item's metadata, meaning the
        // resource doesn't have to be "410 Gone".
        return 404;
      default:
        // Other kinds of errors are just considered "bad gateway" errors
        // because we don't want to own them.
        return 502;
    }
  }
}
