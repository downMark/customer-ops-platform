import { config } from "../config";
import { withTimeout } from "../lib/signals";

export async function getModelServerHealth(
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const response = await fetch(`${config.modelServerBaseUrl}/models`, {
      headers: {
        authorization: `Bearer ${config.modelServerApiKey}`,
        accept: "application/json",
      },
      signal: withTimeout(3_000, signal),
    });
    if (!response.ok) {
      return false;
    }

    const body = (await response.json()) as {
      data?: Array<{ id?: string }>;
    };
    return (body.data ?? []).some(
      ({ id }) => id === config.modelServerModel,
    );
  } catch {
    return false;
  }
}
