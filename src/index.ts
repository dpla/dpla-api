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

  const app: Application = express();
  app.use(morgan("tiny"));

  const awsOptions = { region: process.env.REGION || "us-east-1" };
  const thumbnailBucket = process.env.BUCKET || "dpla-thumbnails";
  let s3 = new S3Client(awsOptions);
  let sqs = new SQSClient(awsOptions);

  if (process.env.XRAY === "true") {
    const XRayExpress = AWSXRay.express;
    app.use(XRayExpress.openSegment("dpla-api"));
    AWSXRay.config([AWSXRay.plugins.ECSPlugin]);
    AWSXRay.capturePromise();
    AWSXRay.captureHTTPsGlobal(https, true);
    sqs = AWSXRay.captureAWSClient(sqs);
    s3 = AWSXRay.captureAWSClient(s3);
  }

  const pool: Pool = new Pool({
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    port: parseInt(process.env.DB_PORT || "5432"),
  });

  const elasticsearch =
    process.env.ELASTIC_URL || "http://search-prod.internal.dp.la:9200/";

  const esClient: Client = new Client({
    node: elasticsearch,
    maxRetries: 5,
    requestTimeout: 60000,
    sniffOnStart: true,
    sniffOnConnectionFault: true,
  });

  const healthController = new HealthController();

  app.get("/health", async (_req, res) => {
    const response = await healthController.getHealth();
    return res.send(response);
  });

  const thumbnailController = new ThumbnailController(
    thumbnailBucket,
    s3,
    sqs,
    esClient,
  );

  app.get("/thumb/*", async (_req, res) => {
    const response = await thumbnailController.handle(_req, res);
    return res.send(response);
  });

  app.listen(PORT, () => {
    console.log("Server is running on port", PORT);
  });
}
