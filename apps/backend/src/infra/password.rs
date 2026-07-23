//! Argon2id 密码哈希校验。

use argon2::{Argon2, PasswordHash, PasswordVerifier as _};

use crate::domain::auth::{AuthServiceError, PasswordVerifier};

pub struct Argon2PasswordVerifier;

impl PasswordVerifier for Argon2PasswordVerifier {
    fn verify(&self, password: &str, password_hash: &str) -> Result<bool, AuthServiceError> {
        let parsed = PasswordHash::new(password_hash)
            .map_err(|error| AuthServiceError(error.to_string()))?;
        Ok(Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok())
    }
}

#[cfg(test)]
mod tests {
    use argon2::password_hash::{PasswordHasher, SaltString};

    use super::*;

    fn test_hash() -> String {
        let salt = SaltString::encode_b64(b"unit-test-salt").unwrap();
        Argon2::default()
            .hash_password(b"correct-password", &salt)
            .unwrap()
            .to_string()
    }

    #[test]
    fn verifies_correct_password() {
        assert!(Argon2PasswordVerifier
            .verify("correct-password", &test_hash())
            .unwrap());
    }

    #[test]
    fn rejects_wrong_password() {
        assert!(!Argon2PasswordVerifier
            .verify("wrong-password", &test_hash())
            .unwrap());
    }

    #[test]
    fn reports_malformed_hash() {
        assert!(Argon2PasswordVerifier
            .verify("correct-password", "bad")
            .is_err());
    }
}
