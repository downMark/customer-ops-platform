import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured`);
  return value;
};
const bucket = required("PERFORMANCE_DETAIL_BUCKET");
const endpoint = required("SENTRY_OTLP_TRACES_URL");
const environment = process.env.PERFORMANCE_ENVIRONMENT || "production";
const authorization = process.env.SENTRY_AUTH_HEADER;
const directory = path.dirname(fileURLToPath(import.meta.url));
const checkpointPath = path.join(directory, ".runtime", "sync-checkpoint.json");
const s3 = new S3Client({});

let checkpoint = { lastKey: "" };
try {
  checkpoint = JSON.parse(await fs.readFile(checkpointPath, "utf8"));
} catch {
  // First synchronization starts from the oldest retained object.
}

const listed = await s3.send(new ListObjectsV2Command({
  Bucket: bucket,
  Prefix: `environment=${environment}/`,
  StartAfter: checkpoint.lastKey || undefined,
  MaxKeys: 100,
}));

for (const object of listed.Contents ?? []) {
  if (!object.Key) continue;
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: object.Key }));
  const bytes = await result.Body?.transformToByteArray();
  if (!bytes) continue;
  const events = gunzipSync(bytes).toString("utf8").trim().split("\n")
    .filter(Boolean).map((line) => JSON.parse(line));
  const body = toOtlp(events);
  if (body.resourceSpans[0].scopeSpans[0].spans.length) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Sentry OTLP returned ${response.status}`);
  }
  checkpoint.lastKey = object.Key;
  await fs.mkdir(path.dirname(checkpointPath), { recursive: true });
  await fs.writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2));
}

console.log(`Sentry synchronization complete through ${checkpoint.lastKey || "no objects"}`);

function toOtlp(events) {
  const groups = Map.groupBy(
    events.filter((event) => event.eventType !== "metric"),
    (event) => `${event.service}\u0000${event.release}`,
  );
  return {
    resourceSpans: [...groups.values()].map((serviceEvents) => {
      const first = serviceEvents[0];
      return {
        resource: { attributes: [
          { key: "service.namespace", value: { stringValue: "customer-ops" } },
          { key: "service.name", value: { stringValue: first.service } },
          { key: "service.version", value: { stringValue: first.release } },
          { key: "deployment.environment", value: { stringValue: environment } },
        ] },
        scopeSpans: [{
          scope: { name: "customer-ops-performance-sync", version: "0.1.0" },
          spans: serviceEvents.map((event) => {
          const start = BigInt(Date.parse(event.occurredAt)) * 1_000_000n;
          const end = start + BigInt(Math.round((event.durationMs || 0) * 1_000_000));
          const errorType = event.attributes?.errorType || "PerformanceError";
          return {
            traceId: event.traceId,
            spanId: event.spanId,
            ...(event.parentSpanId ? { parentSpanId: event.parentSpanId } : {}),
            name: event.operation,
            kind: 1,
            startTimeUnixNano: start.toString(),
            endTimeUnixNano: end.toString(),
            attributes: [
              { key: "customer_ops.event_id", value: { stringValue: event.eventId } },
              ...Object.entries(event.measurements || {}).map(([key, value]) => ({
                key: `customer_ops.${key}`,
                value: { doubleValue: value },
              })),
              ...Object.entries(event.attributes || {}).map(([key, value]) => ({
                key: `customer_ops.${key}`,
                value: typeof value === "number" ? { doubleValue: value } : { stringValue: value },
              })),
            ],
            status: {
              code: event.status === "ok" ? 1 : 2,
              message: event.status,
            },
            ...(event.eventType === "error" || event.status !== "ok" ? {
              events: [{
                timeUnixNano: start.toString(),
                name: "exception",
                attributes: [
                  { key: "exception.type", value: { stringValue: errorType } },
                  { key: "exception.escaped", value: { boolValue: true } },
                  ...(event.attributes?.errorFingerprint ? [{
                    key: "customer_ops.error_fingerprint",
                    value: { stringValue: event.attributes.errorFingerprint },
                  }] : []),
                ],
              }],
            } : {}),
          };
          }),
        }],
      };
    }),
  };
}
