//! 鉴权抽象：已验证身份 `AuthUser` 与 `TokenVerifier` trait。
//! userId 只能来自已验证 token，绝不信任前端传入（docs §12）。

use crate::domain::user::UserAccount;

/// 已验证身份。`user_id` 是唯一可信的用户来源。
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthError {
    InvalidToken,
}

#[derive(Debug)]
pub struct AuthServiceError(pub String);

pub struct IssuedToken {
    pub access_token: String,
    pub expires_in: u64,
}

/// token 校验器。校验为纯 CPU 操作，同步接口即可，便于 `Arc<dyn>` 装配。
/// MVP 实现为 JWT HS256；后续可换 JWKS/真实 IdP 而不动上层。
pub trait TokenVerifier: Send + Sync {
    fn verify(&self, bearer_token: &str) -> Result<AuthUser, AuthError>;
}

pub trait PasswordVerifier: Send + Sync {
    fn verify(&self, password: &str, password_hash: &str) -> Result<bool, AuthServiceError>;
}

pub trait TokenIssuer: Send + Sync {
    fn issue(&self, account: &UserAccount) -> Result<IssuedToken, AuthServiceError>;
}
