/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Backend Lambda API. */
  readonly VITE_API_BASE_URL?: string;
  /** Base URL of the model-api (Mastra) chat/SSE service. */
  readonly VITE_CHAT_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
