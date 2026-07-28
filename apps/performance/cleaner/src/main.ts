import {
  DescribeStreamSummaryCommand,
  GetRecordsCommand,
  GetShardIteratorCommand,
  KinesisClient,
  ListShardsCommand,
} from "@aws-sdk/client-kinesis";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { decodeCloudWatchRecord } from "./events.js";
import { EventProcessor } from "./processor.js";
import { CheckpointStore } from "./checkpoint.js";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured`);
  return value;
};

const streamName = required("PERFORMANCE_STREAM_NAME");
const stateTable = required("PERFORMANCE_STATE_TABLE");
const aggregateTable = required("PERFORMANCE_AGGREGATE_TABLE");
const detailBucket = required("PERFORMANCE_DETAIL_BUCKET");
const retentionDays = Number(process.env.PERFORMANCE_RETENTION_DAYS || "30");
const kinesis = new KinesisClient({});
const document = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const processor = new EventProcessor(document, new S3Client({}), {
  stateTable, aggregateTable, detailBucket, retentionDays,
});
const checkpoints = new CheckpointStore(document, stateTable);
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

async function consumeShard(shardId: string) {
  const sequence = await checkpoints.read(shardId);
  const iterator = await kinesis.send(new GetShardIteratorCommand({
    StreamName: streamName, ShardId: shardId,
    ShardIteratorType: sequence ? "AFTER_SEQUENCE_NUMBER" : "TRIM_HORIZON",
    StartingSequenceNumber: sequence,
  }));
  let next = iterator.ShardIterator;
  while (!stopping && next) {
    const output = await kinesis.send(new GetRecordsCommand({
      ShardIterator: next, Limit: 1_000,
    }));
    next = output.NextShardIterator;
    let accepted = 0;
    for (const record of output.Records ?? []) {
      if (!record.Data) continue;
      const decoded = decodeCloudWatchRecord(record.Data);
      if (decoded.invalidCount) {
        console.warn(JSON.stringify({
          level: "warning",
          message: "invalid performance events dropped",
          invalidCount: decoded.invalidCount,
        }));
      }
      accepted += await processor.process(decoded.events);
      if (record.SequenceNumber) {
        await checkpoints.write(shardId, record.SequenceNumber);
      }
    }
    if (accepted) console.log(JSON.stringify({ level: "info", message: "performance events cleaned", accepted }));
    await new Promise((resolve) => setTimeout(resolve, output.Records?.length ? 250 : 1_000));
  }
}

async function main() {
  await kinesis.send(new DescribeStreamSummaryCommand({ StreamName: streamName }));
  const listed = await kinesis.send(new ListShardsCommand({ StreamName: streamName }));
  await Promise.all((listed.Shards ?? []).map((shard) => consumeShard(shard.ShardId!)));
}

main().catch((error) => {
  console.error(JSON.stringify({ level: "error", message: "cleaner stopped", errorType: error?.name || "Error" }));
  process.exitCode = 1;
});
