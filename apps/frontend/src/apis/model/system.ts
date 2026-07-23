export interface ServiceEndpoint {
  key: string;
  label: string;
  icon: string; // material symbol name
  value: string;
}

export interface InferenceConfig {
  models: { label: string; value: string }[];
  active: string;
  note: string;
}

export interface ServiceRules {
  version: string; // e.g. "V2.4 LIVE"
  systemPrompt: string;
  lastUpdated: string; // e.g. "Oct 24, 14:22 PM"
}

export type ServiceState = "ok" | "warning" | "error";

export interface ServiceStatusItem {
  key: string;
  name: string;
  state: ServiceState;
  detail: string;
}

export interface SettingsView {
  endpoints: ServiceEndpoint[];
  inference: InferenceConfig;
  rules: ServiceRules;
  status: ServiceStatusItem[];
}
