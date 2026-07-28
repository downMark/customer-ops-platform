import assert from "node:assert/strict";
import test from "node:test";
import { CheckpointStore } from "./checkpoint.js";

test("restores and advances a shard checkpoint", async () => {
  let stored: Record<string, unknown> | undefined = {
    pk: "checkpoint#shard-1",
    sequenceNumber: "100",
  };
  const dynamo = {
    async send(command: { input: Record<string, unknown> }) {
      if ("Key" in command.input) return { Item: stored };
      stored = command.input.Item as Record<string, unknown>;
      return {};
    },
  };
  const checkpoints = new CheckpointStore(dynamo as never, "state");
  assert.equal(await checkpoints.read("shard-1"), "100");
  await checkpoints.write("shard-1", "101");
  assert.equal(stored?.sequenceNumber, "101");
});
