import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { config } from "../../config";

export const modelServer = createOpenAICompatible({
  name: "customer-ops-model-server",
  baseURL: config.modelServerBaseUrl,
  apiKey: config.modelServerApiKey,
});

export const customerOpsModel = modelServer(config.modelServerModel);
