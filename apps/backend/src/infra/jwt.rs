//! JWT HS256 签发与校验。claims.sub → AuthUser.user_id。

use chrono::Utc;
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

use crate::domain::auth::{
    AuthError, AuthServiceError, AuthUser, IssuedToken, TokenIssuer, TokenVerifier,
};
use crate::domain::user::UserAccount;

#[cfg(test)]
const DEFAULT_TTL_SECONDS: u64 = 86_400;

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    /// 用户标识（映射为 AuthUser.user_id）。
    sub: String,
    /// 过期时间（秒）；由库校验。
    #[allow(dead_code)]
    exp: usize,
    #[serde(default)]
    iat: Option<usize>,
    #[serde(default)]
    role: Option<String>,
}

pub struct JwtVerifier {
    decoding_key: DecodingKey,
    encoding_key: EncodingKey,
    validation: Validation,
    ttl_seconds: u64,
}

impl JwtVerifier {
    #[cfg(test)]
    pub fn new(secret: &str) -> Self {
        Self::with_ttl(secret, DEFAULT_TTL_SECONDS)
    }

    pub fn with_ttl(secret: &str, ttl_seconds: u64) -> Self {
        Self {
            decoding_key: DecodingKey::from_secret(secret.as_bytes()),
            encoding_key: EncodingKey::from_secret(secret.as_bytes()),
            validation: Validation::new(Algorithm::HS256),
            ttl_seconds,
        }
    }
}

impl TokenVerifier for JwtVerifier {
    fn verify(&self, bearer_token: &str) -> Result<AuthUser, AuthError> {
        let data =
            decode::<Claims>(bearer_token, &self.decoding_key, &self.validation).map_err(|e| {
                tracing::debug!(error = %e, "jwt verify failed");
                AuthError::InvalidToken
            })?;
        if data.claims.sub.trim().is_empty() {
            return Err(AuthError::InvalidToken);
        }
        Ok(AuthUser {
            user_id: data.claims.sub,
        })
    }
}

impl TokenIssuer for JwtVerifier {
    fn issue(&self, account: &UserAccount) -> Result<IssuedToken, AuthServiceError> {
        let issued_at = Utc::now().timestamp().max(0) as usize;
        let expires_at = issued_at.saturating_add(self.ttl_seconds as usize);
        let claims = Claims {
            sub: account.user_id.clone(),
            exp: expires_at,
            iat: Some(issued_at),
            role: Some(account.role.clone()),
        };
        let access_token = encode(&Header::new(Algorithm::HS256), &claims, &self.encoding_key)
            .map_err(|error| AuthServiceError(error.to_string()))?;
        Ok(IssuedToken {
            access_token,
            expires_in: self.ttl_seconds,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{encode, EncodingKey, Header};
    use serde::Serialize;

    #[derive(Serialize)]
    struct TestClaims {
        sub: String,
        exp: usize,
    }

    const FAR_FUTURE: usize = 4_102_444_800; // 2100-01-01

    fn token(secret: &str, sub: &str, exp: usize) -> String {
        encode(
            &Header::new(Algorithm::HS256),
            &TestClaims {
                sub: sub.to_string(),
                exp,
            },
            &EncodingKey::from_secret(secret.as_bytes()),
        )
        .unwrap()
    }

    #[test]
    fn verifies_valid_token() {
        let v = JwtVerifier::new("secret");
        let user = v
            .verify(&token("secret", "test-user-1", FAR_FUTURE))
            .unwrap();
        assert_eq!(user.user_id, "test-user-1");
    }

    #[test]
    fn rejects_wrong_secret() {
        let v = JwtVerifier::new("secret");
        let t = token("other-secret", "u", FAR_FUTURE);
        assert!(matches!(v.verify(&t), Err(AuthError::InvalidToken)));
    }

    #[test]
    fn rejects_expired_token() {
        let v = JwtVerifier::new("secret");
        let t = token("secret", "u", 1_000_000_000); // 2001, expired
        assert!(matches!(v.verify(&t), Err(AuthError::InvalidToken)));
    }

    #[test]
    fn rejects_garbage() {
        let v = JwtVerifier::new("secret");
        assert!(matches!(
            v.verify("not-a-jwt"),
            Err(AuthError::InvalidToken)
        ));
    }

    #[test]
    fn issues_compatible_token_with_role_and_ttl() {
        let service = JwtVerifier::with_ttl("secret", 3_600);
        let account = UserAccount {
            user_id: "test-operator".into(),
            username: "test-operator".into(),
            password_hash: "unused".into(),
            role: "operator".into(),
            is_active: true,
        };
        let issued = service.issue(&account).unwrap();
        assert_eq!(issued.expires_in, 3_600);
        assert_eq!(
            service.verify(&issued.access_token).unwrap().user_id,
            "test-operator"
        );

        let data = decode::<Claims>(
            &issued.access_token,
            &DecodingKey::from_secret(b"secret"),
            &Validation::new(Algorithm::HS256),
        )
        .unwrap();
        assert_eq!(data.claims.role.as_deref(), Some("operator"));
        assert!(data.claims.iat.is_some());
    }
}
