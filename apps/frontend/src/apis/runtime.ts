export const getModelApiBaseURL = () =>
  (typeof import.meta !== "undefined" &&
    (import.meta.env?.VITE_CHAT_API_BASE_URL as string | undefined)) ||
  "http://localhost:4111";
