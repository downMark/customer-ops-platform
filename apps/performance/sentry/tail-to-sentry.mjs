import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEnvelopes, parseDsn } from "./event-to-sentry.mjs";

const SCHEMA = "customer-ops.performance.v1";

export function parsePerformanceLine(line) {
  const start = line.indexOf("{");
  if (start < 0) return null;
  try {
    const event = JSON.parse(line.slice(start));
    return event?.schema === SCHEMA
      && typeof event.eventId === "string"
      && typeof event.operation === "string"
      ? event
      : null;
  } catch {
    return null;
  }
}

export async function postEnvelope(
  envelope,
  { envelopeUrl, sentryKey, fetchImpl = fetch, retries = 3 },
) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(envelopeUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-sentry-envelope",
          "x-sentry-auth": [
            "Sentry sentry_version=7",
            `sentry_key=${sentryKey}`,
            "sentry_client=customer-ops-tail/0.1.0",
          ].join(", "),
        },
        body: envelope.body,
      });
      if (response.ok) return;
      lastError = new Error(`Sentry envelope endpoint returned ${response.status}`);
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastError ?? new Error("Sentry envelope delivery failed");
}

export async function runTail({
  input = process.stdin,
  dsn,
  environment = "local",
  fetchImpl = fetch,
  onProgress = (summary) => console.error(JSON.stringify(summary)),
}) {
  const { key: sentryKey, envelopeUrl } = parseDsn(dsn);
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let scanned = 0;
  let forwarded = 0;
  let failed = 0;

  for await (const line of lines) {
    const event = parsePerformanceLine(line);
    if (!event) continue;
    scanned += 1;
    const envelopes = buildEnvelopes([event], {
      dsn,
      environment,
      sentAt: new Date().toISOString(),
    });
    for (const envelope of envelopes) {
      try {
        await postEnvelope(envelope, { envelopeUrl, sentryKey, fetchImpl });
        forwarded += 1;
        onProgress({
          level: "info",
          message: "local performance event forwarded to Sentry",
          eventId: envelope.eventId,
          operation: event.operation,
          forwarded,
        });
      } catch (error) {
        failed += 1;
        onProgress({
          level: "error",
          message: "local performance event delivery failed",
          eventId: envelope.eventId,
          operation: event.operation,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return { scanned, forwarded, failed };
}

async function main() {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) throw new Error("SENTRY_DSN must be configured");
  const summary = await runTail({
    dsn,
    environment: process.env.PERFORMANCE_ENVIRONMENT || "local",
  });
  console.error(JSON.stringify({
    level: summary.failed > 0 ? "error" : "info",
    message: "local Sentry tail stopped",
    ...summary,
  }));
  if (summary.failed > 0) process.exitCode = 1;
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (fileURLToPath(import.meta.url) === entrypoint) {
  await main();
}
