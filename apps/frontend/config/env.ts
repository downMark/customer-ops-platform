import { defaultApiBaseURL } from "./constants";

interface ClientImportMetaEnv {
  VITE_API_BASE_URL?: string;
}

const getClientEnv = (): ClientImportMetaEnv => {
  if (typeof import.meta !== "undefined") {
    return import.meta.env as ClientImportMetaEnv;
  }

  return {};
};

export const getClientApiBaseURL = () =>
  getClientEnv().VITE_API_BASE_URL || defaultApiBaseURL;

export const getServerApiBaseURL = () =>
  process.env.SSR_API_BASE_URL ||
  process.env.VITE_API_BASE_URL ||
  defaultApiBaseURL;
