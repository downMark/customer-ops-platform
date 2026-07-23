//! 用户账号与仓储抽象。

use async_trait::async_trait;

use super::repository::RepoError;

#[derive(Debug, Clone)]
pub struct UserAccount {
    pub user_id: String,
    pub username: String,
    pub password_hash: String,
    pub role: String,
    pub is_active: bool,
}

#[async_trait]
pub trait UserRepository: Send + Sync {
    async fn find_by_username(&self, username: &str) -> Result<Option<UserAccount>, RepoError>;
}
