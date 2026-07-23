//! SeaORM 对话完成记录仓储。conversation_id 唯一 + ON CONFLICT DO NOTHING 实现幂等。

use async_trait::async_trait;
use sea_orm::sea_query::OnConflict;
use sea_orm::{DatabaseConnection, EntityTrait, Set, TryInsertResult};

use crate::domain::conversation::{ConversationCompletion, ConversationRepository, SaveOutcome};
use crate::domain::repository::RepoError;
use crate::infra::entity::conversation_completions as entity;
use crate::infra::error::map_db_err;

pub struct SeaOrmConversationRepository {
    db: DatabaseConnection,
}

impl SeaOrmConversationRepository {
    pub fn new(db: DatabaseConnection) -> Self {
        Self { db }
    }
}

#[async_trait]
impl ConversationRepository for SeaOrmConversationRepository {
    async fn save_once(&self, rec: &ConversationCompletion) -> Result<SaveOutcome, RepoError> {
        let model = entity::ActiveModel {
            conversation_id: Set(rec.conversation_id.clone()),
            order_id: Set(rec.order_id.clone()),
            trace_id: Set(rec.trace_id.clone()),
            occurred_at: Set(rec.occurred_at),
            ..Default::default()
        };

        // do_nothing 冲突时不报错；用受影响行数判定是否首次插入。
        let res = entity::Entity::insert(model)
            .on_conflict(
                OnConflict::column(entity::Column::ConversationId)
                    .do_nothing()
                    .to_owned(),
            )
            .do_nothing()
            .exec(&self.db)
            .await
            .map_err(map_db_err)?;

        // Conflicted → 已存在；Inserted/Empty → 视为已插入（单条插入不会 Empty）。
        match res {
            TryInsertResult::Conflicted => Ok(SaveOutcome::AlreadyExists),
            _ => Ok(SaveOutcome::Inserted),
        }
    }
}
