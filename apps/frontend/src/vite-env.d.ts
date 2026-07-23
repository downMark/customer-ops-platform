/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for mock/data API (json-server in dev). */
  readonly VITE_API_BASE_URL?: string;
  /** Base URL of the model-api (Mastra) chat/SSE service. */
  readonly VITE_CHAT_API_BASE_URL?: string;
  /** "false" to hit the real SSE endpoint; otherwise a local mock stream runs. */
  readonly VITE_USE_MOCK_STREAM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
