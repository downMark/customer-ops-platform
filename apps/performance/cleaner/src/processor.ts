import { gzipSync } from "node:zlib";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { histogramBucket, minuteBucket, type PerformanceEvent } from "./events.js";

let detailSequence = 0;

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
    for (const event of events) {
      if (await this.claim(event)) {
        await this.aggregate(event);
        accepted.push(event);
      }
    }
    const details = accepted.filter((event) => event.eventType !== "metric");
    if (details.length) await this.storeDetails(details);
    return accepted.length;
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

  private async storeDetails(events: PerformanceEvent[]): Promise<void> {
    const first = events[0];
    const date = new Date(first.occurredAt);
    const prefix = [
      `environment=${first.environment}`,
      `date=${date.toISOString().slice(0, 10)}`,
      `hour=${date.toISOString().slice(11, 13)}`,
    ].join("/");
    detailSequence = (detailSequence + 1) % 1_000_000;
    const orderedId = `${Date.now().toString().padStart(13, "0")}-${detailSequence.toString().padStart(6, "0")}`;
    const body = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
    await this.s3.send(new PutObjectCommand({
      Bucket: this.config.detailBucket,
      Key: `${prefix}/${orderedId}-service=${first.service}-${crypto.randomUUID()}.jsonl.gz`,
      Body: gzipSync(body),
      ContentEncoding: "gzip",
      ContentType: "application/x-ndjson",
      ServerSideEncryption: "AES256",
    }));
  }
}
