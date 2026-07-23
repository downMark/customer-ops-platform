//! 建 `orders` 表并插入固定测试订单 `COP-10086`（docs §6.2/§13 阶段一）。

use chrono::{DateTime, Utc};
use sea_orm_migration::prelude::*;
use sea_orm_migration::sea_orm::{ConnectionTrait, DbBackend, Statement};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
enum Orders {
    Table,
    Id,
    OrderId,
    UserId,
    Status,
    StatusText,
    Carrier,
    TrackingNumber,
    EstimatedDeliveryAt,
    UpdatedAt,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Orders::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Orders::Id)
                            .big_integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(Orders::OrderId)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(ColumnDef::new(Orders::UserId).string().not_null())
                    .col(ColumnDef::new(Orders::Status).string().not_null())
                    .col(ColumnDef::new(Orders::StatusText).string().not_null())
                    .col(ColumnDef::new(Orders::Carrier).string().null())
                    .col(ColumnDef::new(Orders::TrackingNumber).string().null())
                    .col(
                        ColumnDef::new(Orders::EstimatedDeliveryAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(Orders::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_orders_user_id")
                    .table(Orders::Table)
                    .col(Orders::UserId)
                    .to_owned(),
            )
            .await?;

        // 种子数据：参数化插入，幂等（ON CONFLICT DO NOTHING）。
        let estimated: DateTime<Utc> = DateTime::parse_from_rfc3339("2026-07-25T18:00:00Z")
            .expect("valid rfc3339")
            .with_timezone(&Utc);
        let updated: DateTime<Utc> = DateTime::parse_from_rfc3339("2026-07-22T12:00:00Z")
            .expect("valid rfc3339")
            .with_timezone(&Utc);

        let db = manager.get_connection();
        db.execute(Statement::from_sql_and_values(
            DbBackend::Postgres,
            r#"INSERT INTO orders
                (order_id, user_id, status, status_text, carrier, tracking_number, estimated_delivery_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (order_id) DO NOTHING"#,
            [
                "COP-10086".into(),
                "test-user-1".into(),
                "shipped".into(),
                "已发货".into(),
                "测试物流".into(),
                "TEST-10086".into(),
                estimated.into(),
                updated.into(),
            ],
        ))
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Orders::Table).if_exists().to_owned())
            .await?;
        Ok(())
    }
}
