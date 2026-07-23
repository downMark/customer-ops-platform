import { AuthSession, LoginResult } from "../model/auth";
import { getModelApiBaseURL } from "../runtime";

const STORAGE_KEY = "customer-ops.auth";

interface ApiEnvelope<T> {
  code: number;
  success: boolean;
  msg: string;
  data: T | null;
}

class AuthService {
  static async login(username: string, password: string): Promise<AuthSession> {
    const response = await fetch(`${getModelApiBaseURL()}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ username, password }),
    });
    const body = (await response.json().catch(() => null)) as
      | ApiEnvelope<LoginResult>
      | null;
    if (!response.ok || !body?.success || !body.data) {
      throw new Error(
        response.status === 401
          ? "用户名或密码错误"
          : body?.msg || "登录服务暂时不可用"
      );
    }

    const session: AuthSession = {
      ...body.data,
      expiresAt: Date.now() + body.data.expiresIn * 1_000,
    };
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    }
    return session;
  }

  static getSession(): AuthSession | null {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const session = JSON.parse(raw) as AuthSession;
      if (
        !session.accessToken ||
        !session.user?.userId ||
        session.expiresAt <= Date.now()
      ) {
        this.clearSession();
        return null;
      }
      return session;
    } catch {
      this.clearSession();
      return null;
    }
  }

  static getAccessToken(): string | null {
    return this.getSession()?.accessToken ?? null;
  }

  static clearSession(): void {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }
}

export default AuthService;
