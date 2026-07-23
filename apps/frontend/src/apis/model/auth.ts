export interface AuthUser {
  userId: string;
  username: string;
  role: string;
}

export interface LoginResult {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  user: AuthUser;
}

export interface AuthSession extends LoginResult {
  expiresAt: number;
}
