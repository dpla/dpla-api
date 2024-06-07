import crypto from "crypto";
import fetch from "node-fetch";
import { Client } from "@elastic/elasticsearch";
import { SQSClient } from "@aws-sdk/client-sqs";
import {
  S3Client,
  ListObjectsCommand,
  ListObjectsOutput,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import ThumbnailController from "./thumbnail";

const options = { region: "us-east-1" };
const s3 = new S3Client(options);
const sqs = new SQSClient(options);
const esClient: Client = new Client({
  node: process.env.ELASTIC_URL || "http://search.internal.dp.la:9200/",
  maxRetries: 5,
  requestTimeout: 60000,
  sniffOnStart: true,
});

const thumb = new ThumbnailController("dpla-thumbnails", s3, sqs, esClient);

test("getS3Key", () => {
  const testData: object = {
    "223ea5040640813b6c8204d1e0778d30":
      "2/2/3/e/223ea5040640813b6c8204d1e0778d30.jpg",
    "11111111111111111111111111111111":
      "1/1/1/1/11111111111111111111111111111111.jpg",
  };

  Object.entries(testData).forEach(([key, value]) => {
    const result = thumb.getS3Key(key);
    expect(result).toBe(value);
  });
});

test("lookupImageInS3", async () => {
  const params = {
    Bucket: "dpla-thumbnails",
  };
  const list: ListObjectsOutput = await s3.send(new ListObjectsCommand(params));

  if (list.Contents && list.Contents.length > 0) {
    const path = list.Contents[0].Key as string;
    const result = /([a-f0-9]{32}).jpg$/.exec(path);
    if (result) {
      const itemId = result[1];
      //this will throw if it doesn't find one
      await thumb.lookupImageInS3(itemId);
      //this will fail if the promise rejects.
    } else {
      throw new Error("couldn't find item id in key: " + path);
    }
  } else {
    throw new Error("No keys found in bucket.");
  }
});

test("getS3Url", async () => {
  const id = "0000f6ee924d7b60bbfefbc670575653";
  const result = await s3.send(
    new HeadObjectCommand({
      Bucket: "dpla-thumbnails",
      Key: thumb.getS3Key(id),
    }),
  );
  const origMD5 = result.ETag?.replace(/"/g, "");
  const md5 = crypto.createHash("md5");
  const s3url = await thumb.getS3Url(id);
  const response = await fetch(s3url);
  const buffer = await response.buffer();
  md5.write(buffer);
  expect(md5.digest("hex")).toBe(origMD5);
});

test("getRemoteImagePromise", async () => {
  jest.useFakeTimers();
  const url =
    "https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png";
  const result = await thumb.getRemoteImagePromise(url);
  expect(result.status).toBe(200);
});
