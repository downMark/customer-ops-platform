//! SeaORM 用户仓储实现。

use async_trait::async_trait;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use crate::domain::repository::RepoError;
use crate::domain::user::{UserAccount, UserRepository};
use crate::infra::entity::users;
use crate::infra::error::map_db_err;

pub struct SeaOrmUserRepository {
    db: DatabaseConnection,
}

impl SeaOrmUserRepository {
    pub fn new(db: DatabaseConnection) -> Self {
        Self { db }
    }
}

#[async_trait]
impl UserRepository for SeaOrmUserRepository {
    async fn find_by_username(&self, username: &str) -> Result<Option<UserAccount>, RepoError> {
        let model = users::Entity::find()
            .filter(users::Column::Username.eq(username))
            .one(&self.db)
            .await
            .map_err(map_db_err)?;
        Ok(model.map(UserAccount::from))
    }
}
