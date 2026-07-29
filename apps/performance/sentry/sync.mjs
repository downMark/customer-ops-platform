import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { buildEnvelopes, parseDsn } from "./event-to-sentry.mjs";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured`);
  return value;
};
const bucket = required("PERFORMANCE_DETAIL_BUCKET");
const dsn = required("SENTRY_DSN");
const environment = process.env.PERFORMANCE_ENVIRONMENT || "production";
// 单次运行的对象上限，避免一次拉平积压把内存和 Sentry 配额打满；
// 剩余部分靠 checkpoint 在下次运行继续。
const maxObjects = Number(process.env.SENTRY_SYNC_MAX_OBJECTS || "1000");
const directory = path.dirname(fileURLToPath(import.meta.url));
const checkpointPath = path.join(directory, ".runtime", "sync-checkpoint.json");
const s3 = new S3Client({});
const { key: sentryKey, envelopeUrl } = parseDsn(dsn);

let checkpoint = { lastKey: "" };
try {
  checkpoint = JSON.parse(await fs.readFile(checkpointPath, "utf8"));
} catch {
  // First synchronization starts from the oldest retained object.
}

let scanned = 0;
let forwarded = 0;
let cursor;

// 原实现只取一页（MaxKeys 100）且没有 ContinuationToken 循环，
// 积压一旦超过每次 100 个对象就永远追不上。这里翻页直到本次上限或列完。
paging: do {
  const listed = await s3.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: `environment=${environment}/`,
    StartAfter: cursor ? undefined : (checkpoint.lastKey || undefined),
    ContinuationToken: cursor,
    MaxKeys: 1_000,
  }));
  cursor = listed.IsTruncated ? listed.NextContinuationToken : undefined;

  for (const object of listed.Contents ?? []) {
    if (!object.Key) continue;
    forwarded += await forwardObject(object.Key);
    scanned += 1;
    checkpoint.lastKey = object.Key;
    await writeCheckpoint();
    if (scanned >= maxObjects) break paging;
  }
} while (cursor);

console.log(JSON.stringify({
  level: "info",
  message: "sentry synchronization complete",
  scanned,
  forwarded,
  through: checkpoint.lastKey || "no objects",
  truncated: Boolean(cursor) || scanned >= maxObjects,
}));

async function forwardObject(key) {
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await result.Body?.transformToByteArray();
  if (!bytes) return 0;

  const events = gunzipSync(bytes).toString("utf8").trim().split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const envelopes = buildEnvelopes(events, {
    dsn,
    environment,
    sentAt: new Date().toISOString(),
  });

  for (const envelope of envelopes) {
    const response = await fetch(envelopeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${sentryKey}, sentry_client=customer-ops-sync/0.1.0`,
      },
      body: envelope.body,
    });
    // 429 是 Sentry 限流：抛出而不推进 checkpoint，交给下次运行重试。
    // 事件复用了上游 eventId，Sentry 会按 event_id 去重，重发不会产生重复 issue。
    if (response.status === 429) {
      throw new Error("Sentry rate limited the envelope endpoint; retry later");
    }
    if (!response.ok) {
      throw new Error(`Sentry envelope endpoint returned ${response.status}`);
    }
  }
  return envelopes.length;
}

async function writeCheckpoint() {
  await fs.mkdir(path.dirname(checkpointPath), { recursive: true });
  await fs.writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2));
}
