import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";

export class CheckpointStore {
  constructor(
    private readonly dynamo: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async read(shardId: string): Promise<string | undefined> {
    const result = await this.dynamo.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: `checkpoint#${shardId}` },
    }));
    return result.Item?.sequenceNumber as string | undefined;
  }

  async write(shardId: string, sequenceNumber: string): Promise<void> {
    await this.dynamo.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: `checkpoint#${shardId}`,
        sequenceNumber,
        updatedAt: new Date().toISOString(),
      },
    }));
  }
}
