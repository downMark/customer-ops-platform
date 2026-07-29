import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { gunzipSync } from "node:zlib";
import { analyzePerformance, type AggregateMetric } from "@customer-ops/aiops-agent";
import { demoMetrics, normalizeMetric } from "./metrics.js";
import { demoIssues, loadIssues, sentryConfigured } from "./sentry.js";

const app = express();
const host = "127.0.0.1";
const port = Number(process.env.PERFORMANCE_CONSOLE_PORT || "4318");
const environment = process.env.PERFORMANCE_ENVIRONMENT || "production";
const aggregateTable = process.env.PERFORMANCE_AGGREGATE_TABLE;
const detailBucket = process.env.PERFORMANCE_DETAIL_BUCKET;
const demo = process.env.PERFORMANCE_DEMO === "true" || !aggregateTable;
const dynamoClient = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(dynamoClient);
const s3 = new S3Client({});

app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

async function loadMetrics(hours = 6): Promise<AggregateMetric[]> {
  if (demo) return demoMetrics();
  const end = new Date();
  const start = new Date(end.getTime() - Math.min(24, Math.max(1, hours)) * 3_600_000);
  const items: Record<string, unknown>[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const output = await dynamo.send(new QueryCommand({
      TableName: aggregateTable,
      IndexName: "environment-time-index",
      KeyConditionExpression: "environment = :environment AND bucketStart BETWEEN :start AND :end",
      ExpressionAttributeValues: {
        ":environment": environment,
        ":start": start.toISOString(),
        ":end": end.toISOString(),
      },
      ExclusiveStartKey: cursor,
      ScanIndexForward: true,
    }));
    items.push(...(output.Items ?? []));
    cursor = output.LastEvaluatedKey;
  } while (cursor && items.length < 100_000);
  return items.map((item) => normalizeMetric(item));
}

async function latestTraceObjects(prefix: string) {
  let cursor: string | undefined;
  const objects: Array<{ Key?: string }> = [];
  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: detailBucket,
      Prefix: prefix,
      ContinuationToken: cursor,
      MaxKeys: 1_000,
    }));
    objects.push(...(page.Contents ?? []));
    cursor = page.NextContinuationToken;
  } while (cursor && objects.length < 20_000);
  return objects.slice(-20);
}

app.get("/api/health", async (_request, response) => {
  let awsConnected = demo;
  let awsError: string | undefined;
  if (!demo) {
    try {
      await Promise.all([
        dynamoClient.send(new DescribeTableCommand({ TableName: aggregateTable })),
        detailBucket ? s3.send(new HeadBucketCommand({ Bucket: detailBucket })) : Promise.resolve(),
      ]);
      awsConnected = true;
    } catch (error) {
      awsError = error instanceof Error ? error.name : "AwsConnectionError";
    }
  }
  response.json({
    status: awsConnected ? "ok" : "degraded",
    mode: demo ? "demo" : "aws",
    awsConnected,
    ...(awsError ? { awsError } : {}),
    environment,
    kimiConfigured: Boolean(process.env.MOONSHOT_API_KEY),
    sentryConfigured,
    readOnly: true,
  });
});

app.get("/api/metrics", async (request, response) => {
  try {
    const metrics = await loadMetrics(Number(request.query.hours || "6"));
    response.json({ environment, metrics, refreshedAt: new Date().toISOString() });
  } catch (error) {
    response.status(503).json({ message: "AWS performance metrics are unavailable", errorType: error instanceof Error ? error.name : "Error" });
  }
});

app.get("/api/traces", async (_request, response) => {
  if (demo || !detailBucket) {
    return response.json({ traces: [] });
  }
  try {
    const now = new Date();
    const prefixFor = (date: Date) =>
      `environment=${environment}/date=${date.toISOString().slice(0, 10)}/hour=${date.toISOString().slice(11, 13)}/`;
    let objects = await latestTraceObjects(prefixFor(now));
    if (!objects.length) {
      const previousHour = new Date(now.getTime() - 3_600_000);
      objects = await latestTraceObjects(prefixFor(previousHour));
    }
    const traces: unknown[] = [];
    for (const object of objects.slice(-10).reverse()) {
      const result = await s3.send(new GetObjectCommand({ Bucket: detailBucket, Key: object.Key }));
      const bytes = await result.Body?.transformToByteArray();
      if (!bytes) continue;
      const text = gunzipSync(bytes).toString("utf8");
      for (const line of text.trim().split("\n").slice(-50)) {
        const event = JSON.parse(line) as Record<string, unknown>;
        traces.push({
          traceId: event.traceId,
          spanId: event.spanId,
          parentSpanId: event.parentSpanId,
          occurredAt: event.occurredAt,
          service: event.service,
          release: event.release,
          operation: event.operation,
          status: event.status,
          durationMs: event.durationMs,
          eventType: event.eventType,
        });
      }
    }
    response.json({ traces: traces.slice(0, 100) });
  } catch (error) {
    response.status(503).json({ message: "Trace details are unavailable", errorType: error instanceof Error ? error.name : "Error" });
  }
});

// Sentry 只做 issue/告警，性能指标不走这里；未配置时安静降级，不影响其余面板。
app.get("/api/issues", async (_request, response) => {
  if (demo) {
    return response.json({ configured: sentryConfigured, issues: demoIssues() });
  }
  if (!sentryConfigured) {
    return response.json({ configured: false, issues: [] });
  }
  try {
    const issues = await loadIssues();
    response.json({ configured: true, issues, refreshedAt: new Date().toISOString() });
  } catch (error) {
    response.status(503).json({ message: "Sentry issues are unavailable", errorType: error instanceof Error ? error.name : "Error" });
  }
});

app.post("/api/aiops/analyze", async (_request, response) => {
  try {
    const metrics = await loadMetrics(6);
    response.json(await analyzePerformance(metrics, {
      apiKey: process.env.MOONSHOT_API_KEY,
      baseUrl: process.env.MOONSHOT_BASE_URL,
      model: "kimi-k3",
    }));
  } catch (error) {
    response.status(503).json({ message: "AIOps analysis is unavailable", errorType: error instanceof Error ? error.name : "Error" });
  }
});

if (process.env.NODE_ENV === "production") {
  const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
  app.use(express.static(directory));
  app.get("*path", (_request, response) => response.sendFile(path.join(directory, "index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: {
      middlewareMode: true,
      host,
      hmr: { host },
    },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

app.listen(port, host, (error?: Error) => {
  if (error) throw error;
  console.log(`Customer Ops Performance Console: http://${host}:${port}`);
});
