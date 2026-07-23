//! 为开发演示管理员写入 20 条覆盖常见状态的订单。

use chrono::{DateTime, Duration, Utc};
use sea_orm_migration::prelude::*;
use sea_orm_migration::sea_orm::{ConnectionTrait, DbBackend, Statement};

#[derive(DeriveMigrationName)]
pub struct Migration;

struct OrderSeed {
    status: &'static str,
    status_text: &'static str,
    carrier: Option<&'static str>,
    has_tracking: bool,
    has_estimated_delivery: bool,
}

const ORDER_SEEDS: [OrderSeed; 20] = [
    OrderSeed {
        status: "pending_payment",
        status_text: "待付款",
        carrier: None,
        has_tracking: false,
        has_estimated_delivery: false,
    },
    OrderSeed {
        status: "paid",
        status_text: "已付款",
        carrier: None,
        has_tracking: false,
        has_estimated_delivery: false,
    },
    OrderSeed {
        status: "processing",
        status_text: "处理中",
        carrier: None,
        has_tracking: false,
        has_estimated_delivery: false,
    },
    OrderSeed {
        status: "processing",
        status_text: "等待出库",
        carrier: None,
        has_tracking: false,
        has_estimated_delivery: false,
    },
    OrderSeed {
        status: "shipped",
        status_text: "已发货",
        carrier: Some("顺丰速运"),
        has_tracking: true,
        has_estimated_delivery: true,
    },
    OrderSeed {
        status: "in_transit",
        status_text: "运输中",
        carrier: Some("中通快递"),
        has_tracking: true,
        has_estimated_delivery: true,
    },
    OrderSeed {
        status: "in_transit",
        status_text: "已到达分拨中心",
        carrier: Some("圆通速递"),
        has_tracking: true,
        has_estimated_delivery: true,
    },
    OrderSeed {
        status: "out_for_delivery",
        status_text: "派送中",
        carrier: Some("京东物流"),
        has_tracking: true,
        has_estimated_delivery: true,
    },
    OrderSeed {
        status: "delivered",
        status_text: "已完成",
        carrier: Some("顺丰速运"),
        has_tracking: true,
        has_estimated_delivery: false,
    },
    OrderSeed {
        status: "delivered",
        status_text: "已签收",
        carrier: Some("邮政快递"),
        has_tracking: true,
        has_estimated_delivery: false,
    },
    OrderSeed {
        status: "cancelled",
        status_text: "已取消",
        carrier: None,
        has_tracking: false,
        has_estimated_delivery: false,
    },
    OrderSeed {
        status: "cancelled",
        status_text: "超时未付款已关闭",
        carrier: None,
        has_tracking: false,
        has_estimated_delivery: false,
    },
    OrderSeed {
        status: "refund_pending",
        status_text: "退款审核中",
        carrier: None,
        has_tracking: false,
        has_estimated_delivery: false,
    },
    OrderSeed {
        status: "refunding",
        status_text: "退款处理中",
        carrier: None,
        has_tracking: false,
        has_estimated_delivery: false,
    },
    OrderSeed {
        status: "refunded",
        status_text: "已退款",
        carrier: None,
        has_tracking: false,
        has_estimated_delivery: false,
    },
    OrderSeed {
        status: "return_pending",
        status_text: "退货审核中",
        carrier: None,
        has_tracking: false,
        has_estimated_delivery: false,
    },
    OrderSeed {
        status: "returning",
        status_text: "退货运输中",
        carrier: Some("韵达快递"),
        has_tracking: true,
        has_estimated_delivery: false,
    },
    OrderSeed {
        status: "after_sale",
        status_text: "售后处理中",
        carrier: None,
        has_tracking: false,
        has_estimated_delivery: false,
    },
    OrderSeed {
        status: "delivery_exception",
        status_text: "物流异常",
        carrier: Some("申通快递"),
        has_tracking: true,
        has_estimated_delivery: false,
    },
    OrderSeed {
        status: "completed",
        status_text: "交易完成",
        carrier: Some("京东物流"),
        has_tracking: true,
        has_estimated_delivery: false,
    },
];

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let base_updated = DateTime::parse_from_rfc3339("2026-07-23T12:00:00Z")
            .expect("valid seed timestamp")
            .with_timezone(&Utc);
        let db = manager.get_connection();

        for (index, seed) in ORDER_SEEDS.iter().enumerate() {
            let sequence = index + 1;
            let order_id = format!("ADMIN-2026-{sequence:04}");
            let tracking_number = seed.has_tracking.then(|| format!("DEMO-{sequence:08}"));
            let estimated_delivery_at = seed
                .has_estimated_delivery
                .then(|| base_updated + Duration::days((sequence % 5 + 1) as i64));
            let updated_at = base_updated - Duration::hours((20 - sequence) as i64);

            db.execute(Statement::from_sql_and_values(
                DbBackend::Postgres,
                r#"INSERT INTO orders
                    (order_id, user_id, status, status_text, carrier, tracking_number, estimated_delivery_at, updated_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                   ON CONFLICT (order_id) DO NOTHING"#,
                [
                    order_id.into(),
                    "demo-order-owner".into(),
                    seed.status.into(),
                    seed.status_text.into(),
                    seed.carrier.map(str::to_string).into(),
                    tracking_number.into(),
                    estimated_delivery_at.into(),
                    updated_at.into(),
                ],
            ))
            .await?;
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute(Statement::from_string(
                DbBackend::Postgres,
                "DELETE FROM orders WHERE order_id LIKE 'ADMIN-2026-%'",
            ))
            .await?;
        Ok(())
    }
}
