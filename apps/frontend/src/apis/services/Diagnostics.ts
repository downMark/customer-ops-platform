import { getApiBaseURL } from "../index";
import AuthService from "./Auth";
import { performanceFetch } from "../../performance";

/** 与后端 `DiagnosticsKind` 一一对应。 */
export type DiagnosticsKind =
  | "not_found"
  | "service_unavailable"
  | "timeout"
  | "internal";

export interface DiagnosticsResult {
  status: number;
  /** 后端统一封装里的业务码，用于确认走到了预期的错误分支。 */
  code: number | null;
  msg: string;
}

/** 与后端 `CONFIRMATION` 常量保持一致，防止误触。 */
const CONFIRMATION = "TRIGGER_ERROR_DRILL";

export default class DiagnosticsService {
  /**
   * 触发一次后端错误演练。
   *
   * 这个接口的「成功」就是拿到一个失败响应：后端会先把错误事件发进 performance
   * 链路，再返回对应的 HTTP 错误码。所以这里不把非 2xx 当异常抛出，而是把状态码
   * 和业务码原样返回，交给自检页展示。
   */
  static async triggerError(kind: DiagnosticsKind): Promise<DiagnosticsResult> {
    const token = AuthService.getAccessToken();
    if (!token) throw new Error("登录状态已失效，请重新登录。");
    const response = await performanceFetch(`${getApiBaseURL()}/api/diagnostics/errors`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ kind, confirmation: CONFIRMATION }),
    });
    const body = (await response.json().catch(() => null)) as
      | { code?: number; msg?: string }
      | null;
    return {
      status: response.status,
      code: typeof body?.code === "number" ? body.code : null,
      msg: body?.msg || `HTTP ${response.status}`,
    };
  }
}
