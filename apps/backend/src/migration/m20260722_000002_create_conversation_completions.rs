//! 建 `conversation_completions` 表；`conversation_id` 唯一作幂等键（docs §10）。

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
enum ConversationCompletions {
    Table,
    Id,
    ConversationId,
    OrderId,
    TraceId,
    OccurredAt,
    PublishedAt,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ConversationCompletions::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ConversationCompletions::Id)
                            .big_integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(ConversationCompletions::ConversationId)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(
                        ColumnDef::new(ConversationCompletions::OrderId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ConversationCompletions::TraceId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ConversationCompletions::OccurredAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ConversationCompletions::PublishedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(ConversationCompletions::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}
