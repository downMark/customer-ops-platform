//! `users` 表实体。密码只保存 Argon2id PHC 哈希。

use sea_orm::entity::prelude::*;

use crate::domain::user::UserAccount;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "users")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    #[sea_orm(unique)]
    pub user_id: String,
    #[sea_orm(unique)]
    pub username: String,
    pub password_hash: String,
    pub role: String,
    pub is_active: bool,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

impl From<Model> for UserAccount {
    fn from(model: Model) -> Self {
        Self {
            user_id: model.user_id,
            username: model.username,
            password_hash: model.password_hash,
            role: model.role,
            is_active: model.is_active,
        }
    }
}
