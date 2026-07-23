//! 用户登录用例：统一校验凭据并签发兼容现有鉴权的 JWT。

use std::sync::Arc;

use serde::Serialize;

use crate::application::error::ApplicationError;
use crate::domain::auth::{PasswordVerifier, TokenIssuer};
use crate::domain::user::UserRepository;

pub struct Login {
    users: Arc<dyn UserRepository>,
    passwords: Arc<dyn PasswordVerifier>,
    tokens: Arc<dyn TokenIssuer>,
}

pub struct LoginCommand {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginView {
    pub access_token: String,
    pub token_type: &'static str,
    pub expires_in: u64,
    pub user: LoginUserView,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginUserView {
    pub user_id: String,
    pub username: String,
    pub role: String,
}

impl Login {
    pub fn new(
        users: Arc<dyn UserRepository>,
        passwords: Arc<dyn PasswordVerifier>,
        tokens: Arc<dyn TokenIssuer>,
    ) -> Self {
        Self {
            users,
            passwords,
            tokens,
        }
    }

    pub async fn execute(&self, command: LoginCommand) -> Result<LoginView, ApplicationError> {
        let username = command.username.trim();
        if username.is_empty()
            || username.len() > 64
            || command.password.is_empty()
            || command.password.len() > 128
        {
            return Err(ApplicationError::Unauthorized);
        }

        let account = self
            .users
            .find_by_username(username)
            .await?
            .ok_or(ApplicationError::Unauthorized)?;
        if !account.is_active {
            return Err(ApplicationError::Unauthorized);
        }

        let password_matches = self
            .passwords
            .verify(&command.password, &account.password_hash)
            .map_err(|error| ApplicationError::Internal(error.0))?;
        if !password_matches {
            return Err(ApplicationError::Unauthorized);
        }

        let issued = self
            .tokens
            .issue(&account)
            .map_err(|error| ApplicationError::Internal(error.0))?;

        Ok(LoginView {
            access_token: issued.access_token,
            token_type: "Bearer",
            expires_in: issued.expires_in,
            user: LoginUserView {
                user_id: account.user_id,
                username: account.username,
                role: account.role,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use async_trait::async_trait;

    use super::*;
    use crate::domain::auth::{AuthServiceError, IssuedToken};
    use crate::domain::repository::RepoError;
    use crate::domain::user::UserAccount;

    struct FakeUsers(Option<UserAccount>);

    #[async_trait]
    impl UserRepository for FakeUsers {
        async fn find_by_username(
            &self,
            _username: &str,
        ) -> Result<Option<UserAccount>, RepoError> {
            Ok(self.0.clone())
        }
    }

    struct FakePasswords(bool);

    impl PasswordVerifier for FakePasswords {
        fn verify(&self, _password: &str, _password_hash: &str) -> Result<bool, AuthServiceError> {
            Ok(self.0)
        }
    }

    struct FakeTokens;

    impl TokenIssuer for FakeTokens {
        fn issue(&self, _account: &UserAccount) -> Result<IssuedToken, AuthServiceError> {
            Ok(IssuedToken {
                access_token: "jwt".into(),
                expires_in: 86_400,
            })
        }
    }

    fn account(active: bool) -> UserAccount {
        UserAccount {
            user_id: "test-operator".into(),
            username: "test-operator".into(),
            password_hash: "hash".into(),
            role: "operator".into(),
            is_active: active,
        }
    }

    fn login(user: Option<UserAccount>, password_matches: bool) -> Login {
        Login::new(
            Arc::new(FakeUsers(user)),
            Arc::new(FakePasswords(password_matches)),
            Arc::new(FakeTokens),
        )
    }

    fn command() -> LoginCommand {
        LoginCommand {
            username: "test-operator".into(),
            password: "correct-password".into(),
        }
    }

    #[tokio::test]
    async fn returns_token_for_valid_credentials() {
        let view = login(Some(account(true)), true)
            .execute(command())
            .await
            .unwrap();
        assert_eq!(view.access_token, "jwt");
        assert_eq!(view.user.user_id, "test-operator");
        assert_eq!(view.user.role, "operator");
    }

    #[tokio::test]
    async fn rejects_wrong_password() {
        assert!(matches!(
            login(Some(account(true)), false).execute(command()).await,
            Err(ApplicationError::Unauthorized)
        ));
    }

    #[tokio::test]
    async fn rejects_unknown_user() {
        assert!(matches!(
            login(None, true).execute(command()).await,
            Err(ApplicationError::Unauthorized)
        ));
    }

    #[tokio::test]
    async fn rejects_inactive_user() {
        assert!(matches!(
            login(Some(account(false)), true).execute(command()).await,
            Err(ApplicationError::Unauthorized)
        ));
    }
}
