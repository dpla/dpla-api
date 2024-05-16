import express, { Application } from "express";
import cluster from "node:cluster";
import os from "os";
import { Pool } from "pg";
import morgan from "morgan";

import HealthController from "./controllers/health";
import ThumbnailController from "./controllers/thumbnail";
import AWSXRay from "aws-xray-sdk";
import { Client } from "@elastic/elasticsearch";
import { SQSClient } from "@aws-sdk/client-sqs";
import { S3Client } from "@aws-sdk/client-s3";
import https from "https";
import SearchController from "./controllers/search";

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
  const elasticsearchUrl =
    process.env.ELASTIC_URL || "http://search-prod.internal.dp.la:9200/";
  const elasticsearchIndex = process.env.ELASTIC_INDEX || "dpla_alias";

  const app: Application = express();
  app.use(morgan("tiny")); //http request logger
  app.disable("x-powered-by");

  const awsOptions = { region };

  let s3 = new S3Client(awsOptions);
  let sqs = new SQSClient(awsOptions);

  if (xray) {
    const XRayExpress = AWSXRay.express;
    app.use(XRayExpress.openSegment("dpla-api"));
    AWSXRay.config([AWSXRay.plugins.ECSPlugin]);
    AWSXRay.capturePromise();
    AWSXRay.captureHTTPsGlobal(https, true);
    sqs = AWSXRay.captureAWSClient(sqs);
    s3 = AWSXRay.captureAWSClient(s3);
  }

  const dbPool: Pool = new Pool({
    host: dbHost,
    database: dbName,
    user: dbUser,
    password: dbPass,
    port: dbPort,
  });

  const esClient: Client = new Client({
    node: elasticsearchUrl,
    maxRetries: 5,
    requestTimeout: 60000,
    sniffOnStart: true,
    sniffOnConnectionFault: true,
  });

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
  const searchController = new SearchController(esClient);

  app.get("/v2/item/:id", async (req, res) => {
    const response = await searchController.getItem(
      req.params.id,
      elasticsearchIndex,
    );
    return res.send(response);
  });

  app.listen(PORT, () => {
    console.log("Server is running on port", PORT);
  });
}
