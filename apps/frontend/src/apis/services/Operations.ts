import { getApiBaseURL } from "../index";
import {
  AwsStatus,
  FailureTestAccepted,
  RecoveryAccepted,
} from "../model/operations";
import AuthService from "./Auth";
import { performanceFetch } from "../../performance";

interface Envelope<T> {
  success: boolean;
  msg: string;
  data: T | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = AuthService.getAccessToken();
  if (!token) throw new Error("登录状态已失效，请重新登录。");
  const response = await performanceFetch(`${getApiBaseURL()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as Envelope<T> | null;
  if (!response.ok || !body?.success || body.data == null) {
    throw new Error(body?.msg || `AWS 运行状态暂时不可用 (${response.status})`);
  }
  return body.data;
}

export default class OperationsService {
  static status() {
    return request<AwsStatus>("/api/ops/aws-status");
  }

  static triggerFailureTest() {
    return request<FailureTestAccepted>("/api/ops/failure-tests", {
      method: "POST",
      body: JSON.stringify({ confirmation: "TRIGGER_DLQ_TEST" }),
    });
  }

  static recoverFailureTest(testId: string) {
    return request<RecoveryAccepted>(
      `/api/ops/failure-tests/${encodeURIComponent(testId)}/recover`,
      { method: "POST" },
    );
  }
}
