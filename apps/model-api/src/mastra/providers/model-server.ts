import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { config } from "../../config";
import { tracedFetch } from "../../performance";

export const modelServer = createOpenAICompatible({
  name: "customer-ops-model-server",
  baseURL: config.modelServerBaseUrl,
  apiKey: config.modelServerApiKey,
  fetch: tracedFetch,
});

export const customerOpsModel = modelServer(config.modelServerModel);
