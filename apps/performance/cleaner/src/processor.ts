import { gzipSync } from "node:zlib";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { histogramBucket, minuteBucket, type PerformanceEvent } from "./events.js";

let detailSequence = 0;

// 单条事件要走两次 DynamoDB 往返（认领 + 聚合）。Kinesis 一批可含上千条，
// 串行会让 shard 消费落后，这里限并发而不是无限并发，避免打爆写容量。
const EVENT_CONCURRENCY = 8;

export interface ProcessorConfig {
  stateTable: string;
  aggregateTable: string;
  detailBucket: string;
  retentionDays: number;
}

export class EventProcessor {
  constructor(
    private readonly dynamo: DynamoDBDocumentClient,
    private readonly s3: S3Client,
    private readonly config: ProcessorConfig,
  ) {}

  async process(events: PerformanceEvent[]): Promise<number> {
    const accepted: PerformanceEvent[] = [];
    try {
      await forEachLimited(events, EVENT_CONCURRENCY, async (event) => {
        if (!await this.claim(event)) return;
        accepted.push(event);
        await this.aggregate(event);
      });
      const details = accepted.filter((event) => event.eventType !== "metric");
      if (details.length) await this.storeDetails(details);
      return accepted.length;
    } catch (error) {
      // 认领写的是幂等锁：只要后续任一步失败就必须释放，否则 Kinesis 重投递时
      // claim 会返回 false，这批明细永远不会补写到 S3——聚合有数、trace 缺块，
      // 且不报错。宁可极少数失败场景下聚合重复计数，也不能静默丢明细。
      await this.releaseClaims(accepted);
      throw error;
    }
  }

  private async claim(event: PerformanceEvent): Promise<boolean> {
    try {
      await this.dynamo.send(new PutCommand({
        TableName: this.config.stateTable,
        Item: {
          pk: `event#${event.eventId}`,
          expiresAt: Math.floor(Date.now() / 1000) + this.config.retentionDays * 86_400,
        },
        ConditionExpression: "attribute_not_exists(pk)",
      }));
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException
        || (error as { name?: string }).name === "ConditionalCheckFailedException") return false;
      throw error;
    }
  }

  // 尽力而为：回滚失败不应掩盖真正的原始错误，所以用 allSettled。
  private async releaseClaims(events: readonly PerformanceEvent[]): Promise<void> {
    await Promise.allSettled(events.map((event) => this.dynamo.send(new DeleteCommand({
      TableName: this.config.stateTable,
      Key: { pk: `event#${event.eventId}` },
    }))));
  }

  private async aggregate(event: PerformanceEvent): Promise<void> {
    const bucketStart = minuteBucket(event.occurredAt);
    const duration = event.durationMs ?? 0;
    const bucket = histogramBucket(duration);
    const metricNames: Record<string, string> = { "#bucket": `histogram_${bucket}` };
    const values: Record<string, unknown> = {
      ":zero": 0, ":one": 1, ":duration": duration,
      ":error": event.status === "ok" ? 0 : 1,
      ":environment": event.environment, ":bucketStart": bucketStart,
      ":service": event.service, ":operation": event.operation,
      ":release": event.release,
      ":eventType": event.eventType,
      ":expiresAt": Math.floor(new Date(bucketStart).getTime() / 1000) + this.config.retentionDays * 86_400,
    };
    const metricUpdates: string[] = [];
    for (const [key, value] of Object.entries(event.measurements)) {
      const safe = `m${key}`;
      metricNames[`#${safe}`] = safe;
      values[`:${safe}`] = value;
      metricUpdates.push(`#${safe} = if_not_exists(#${safe}, :zero) + :${safe}`);
    }
    await this.dynamo.send(new UpdateCommand({
      TableName: this.config.aggregateTable,
      Key: {
        pk: `${event.environment}#${event.service}#${event.release}#${event.operation}#${event.eventType}`,
        sk: bucketStart,
      },
      UpdateExpression: `SET environment = if_not_exists(environment, :environment),
        bucketStart = if_not_exists(bucketStart, :bucketStart),
        service = if_not_exists(service, :service),
        release = if_not_exists(release, :release),
        operation = if_not_exists(operation, :operation),
        eventType = if_not_exists(eventType, :eventType),
        expiresAt = :expiresAt,
        sampleCount = if_not_exists(sampleCount, :zero) + :one,
        errorCount = if_not_exists(errorCount, :zero) + :error,
        totalDurationMs = if_not_exists(totalDurationMs, :zero) + :duration,
        #bucket = if_not_exists(#bucket, :zero) + :one
        ${metricUpdates.length ? `, ${metricUpdates.join(", ")}` : ""}`,
      ExpressionAttributeNames: metricNames,
      ExpressionAttributeValues: values,
    }));
  }

  // 一个 Kinesis 批次可以跨整点、跨环境。按分区键分组后逐组落盘，
  // 否则整批会被归到首条事件的 hour/environment 下：跨点的事件会从
  // console 的「当前小时 + 上一小时」查询里漏掉，跨环境的会串数据。
  private async storeDetails(events: PerformanceEvent[]): Promise<void> {
    const groups = new Map<string, PerformanceEvent[]>();
    for (const event of events) {
      const date = new Date(event.occurredAt);
      const prefix = [
        `environment=${event.environment}`,
        `date=${date.toISOString().slice(0, 10)}`,
        `hour=${date.toISOString().slice(11, 13)}`,
      ].join("/");
      const group = groups.get(prefix);
      if (group) group.push(event);
      else groups.set(prefix, [event]);
    }
    for (const [prefix, group] of groups) await this.putDetailObject(prefix, group);
  }

  private async putDetailObject(
    prefix: string,
    events: PerformanceEvent[],
  ): Promise<void> {
    detailSequence = (detailSequence + 1) % 1_000_000;
    const orderedId = `${Date.now().toString().padStart(13, "0")}-${detailSequence.toString().padStart(6, "0")}`;
    // 文件名里的 service 只是排查用的标签；一个分区内仍可能混多个服务，
    // 此时标成 mixed，避免像以前那样只标首条、误导排查。
    const services = new Set(events.map((event) => event.service));
    const label = services.size === 1 ? [...services][0] : "mixed";
    const body = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
    await this.s3.send(new PutObjectCommand({
      Bucket: this.config.detailBucket,
      Key: `${prefix}/${orderedId}-service=${label}-${crypto.randomUUID()}.jsonl.gz`,
      Body: gzipSync(body),
      ContentEncoding: "gzip",
      ContentType: "application/x-ndjson",
      ServerSideEncryption: "AES256",
    }));
  }
}

// 有限并发执行；任一任务失败时先等全部落定再抛出首个错误，
// 保证调用方回滚时不会漏掉仍在飞行中的认领。
async function forEachLimited<T>(
  items: readonly T[],
  limit: number,
  handler: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  let failed = false;
  let failure: unknown;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (cursor < items.length && !failed) {
        const item = items[cursor];
        cursor += 1;
        try {
          await handler(item);
        } catch (error) {
          if (!failed) { failed = true; failure = error; }
          return;
        }
      }
    },
  );
  await Promise.all(workers);
  if (failed) throw failure;
}
