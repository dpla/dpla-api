import express, { Application } from "express";
import cluster from "node:cluster";
import os from "os";
import { Pool } from "pg";
import morgan from "morgan";

import HealthController from "./health/health";
import ThumbnailController from "./thumbnails/thumbnail";
import AWSXRay from "aws-xray-sdk";
import { Client } from "@elastic/elasticsearch";
import { SQSClient } from "@aws-sdk/client-sqs";
import { S3Client } from "@aws-sdk/client-s3";
import https from "https";
import SearchController from "./aggregation/search";
import {
  DPLADocList,
  FourHundredResponse,
  FiveHundredResponse,
  EmailSent,
} from "./aggregation/responses";
import ApiKeyRepository from "./aggregation/api_key_repository";
import { SESClient } from "@aws-sdk/client-ses";
import { Emailer } from "./aggregation/Emailer";

const mustFork =
  process.env.MUST_FORK === "true" || process.env.NODE_ENV === "production";

if (cluster.isPrimary && mustFork) {
  primary();
} else {
  worker();
}

function primary() {
  cluster
    .on("exit", (worker) => {
      console.log(`worker ${worker.process.pid} died`);
    })
    .on("online", (worker) => {
      console.log(`worker ${worker.process.pid} online`);
    });
  const numCPUs = Number(process.env.PS_COUNT) || os.cpus().length;
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
}

function worker() {
  const PORT = process.env.PORT || 8000;
  const region = process.env.AWS_REGION || "us-east-1";
  const thumbnailBucket = process.env.BUCKET || "dpla-thumbnails";
  const xray = process.env.XRAY === "true";
  const dbHost = process.env.DB_HOST;
  const dbName = process.env.DB_NAME;
  const dbUser = process.env.DB_USER;
  const dbPass = process.env.DB_PASS;
  const dbPort = parseInt(process.env.DB_PORT || "5432");
  const dbQueryTimeout = parseInt(process.env.DB_QUERY_TIMEOUT || "10000");
  const elasticsearchUrl =
    process.env.ELASTIC_URL || "http://search.internal.dp.la:9200/";
  const elasticsearchIndex = process.env.ELASTIC_INDEX || "dpla_alias";
  const emailFrom = process.env.EMAIL_FROM || "info@dp.la";

  const app: Application = express();
  app.use(morgan("tiny")); //http request logger
  app.disable("x-powered-by");

  const awsOptions = { region };

  let s3 = new S3Client(awsOptions);
  let sqs = new SQSClient(awsOptions);
  let ses = new SESClient(awsOptions);

  if (xray) {
    const XRayExpress = AWSXRay.express;
    app.use(XRayExpress.openSegment("dpla-api"));
    AWSXRay.config([AWSXRay.plugins.ECSPlugin]);
    AWSXRay.capturePromise();
    AWSXRay.captureHTTPsGlobal(https, true);
    sqs = AWSXRay.captureAWSClient(sqs);
    s3 = AWSXRay.captureAWSClient(s3);
    ses = AWSXRay.captureAWSClient(ses);
  }

  const dbPool: Pool = new Pool({
    host: dbHost,
    database: dbName,
    user: dbUser,
    password: dbPass,
    port: dbPort,
    query_timeout: dbQueryTimeout,
  });

  const emailer = new Emailer(ses, emailFrom);

  const apiKeyRepository = new ApiKeyRepository(dbPool);

  const authMiddleware = async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    let apiKey = "";
    if (req.headers["Authorization"]) {
      apiKey = req.headers["Authorization"] as string;
    } else if (req.query.api_key) {
      if (typeof req.query.api_key === "string") {
        apiKey = req.query.api_key;
      } else if (
        Array.isArray(req.query.api_key) &&
        req.query.api_key.length > 0
      ) {
        apiKey = req.query.api_key[0] as string;
      }
    }

    if (!apiKeyRepository.isApiKeyValid(apiKey)) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const user = await apiKeyRepository.findUserByApiKey(apiKey);

    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    next();
  };

  const esClient: Client = new Client({
    node: elasticsearchUrl,
    maxRetries: 5,
    requestTimeout: 60000,
    sniffOnStart: true,
    sniffOnConnectionFault: true,
  });

  const queryParams = (req: express.Request): Map<string, string> => {
    const params = new Map<string, string>();
    for (const key in Object.entries(req.query)) {
      if (req.query.hasOwnProperty(key)) {
        const value = req.query[key];
        if (typeof value === "string") {
          params.set(key, value);
        } else if (Array.isArray(value)) {
          params.set(key, value[0] as string);
        }
      }
    }
    return params;
  };

  // HEALTH
  const healthController = new HealthController();

  app.get("/health", async (req, res) => {
    const response = await healthController.getHealth();
    return res.send(response);
  });

  //THUMBNAILS
  const thumbnailController = new ThumbnailController(
    thumbnailBucket,
    s3,
    sqs,
    esClient,
  );

  app.get("/thumb/*", async (_req, res) => {
    await thumbnailController.handle(_req, res);
  });

  //SEARCH
  const searchController = new SearchController(
    esClient,
    apiKeyRepository,
    emailer,
  );
  const handleJsonResponses = (
    response:
      | DPLADocList
      | EmailSent
      | FourHundredResponse
      | FiveHundredResponse,
    res: express.Response,
  ) => {
    for (const [header, value] of Object.entries(securityHeaders)) {
      res.setHeader(header, value);
    }
    if (
      response instanceof FourHundredResponse ||
      response instanceof FiveHundredResponse
    ) {
      return res.status(response.errorCode).json(response);
    } else {
      return res.json(response);
    }
  };

  app.get(["/v2/items/:id", "/items/:id"], authMiddleware, async (req, res) => {
    const response = await searchController.getItem(
      req.params.id,
      queryParams(req),
      elasticsearchIndex,
    );

    handleJsonResponses(response, res);
  });

  app.get(["/v2/items", "/items"], authMiddleware, async (req, res) => {
    const response = await searchController.search(
      queryParams(req),
      elasticsearchIndex,
    );

    handleJsonResponses(response, res);
  });

  app.post(["/v2/api_key/:email", "/api_key/:email"], async (req, res) => {
    const email = req.params.email;
    const response = await searchController.createApiKey(email);
    handleJsonResponses(response, res);
  });

  app.listen(PORT, () => {
    console.log("Server is running on port", PORT);
  });
}

/*
  Cribbed from https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
 */

const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; frame-ancestors 'none'; form-action 'self'",
  "Strict-Transport-Security": "max-age=16070400; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};