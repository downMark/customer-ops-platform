use sea_orm_migration::prelude::*;
use sea_orm_migration::sea_orm::{ConnectionTrait, DbBackend, Statement};

#[derive(DeriveMigrationName)]
pub struct Migration;

async fn sql(manager: &SchemaManager<'_>, statement: &str) -> Result<(), DbErr> {
    manager
        .get_connection()
        .execute(Statement::from_string(DbBackend::Postgres, statement))
        .await?;
    Ok(())
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        sql(
            manager,
            r#"CREATE TABLE IF NOT EXISTS products (
            id BIGSERIAL PRIMARY KEY, product_id VARCHAR NOT NULL UNIQUE, name VARCHAR NOT NULL,
            price_cents BIGINT NOT NULL CHECK (price_cents >= 0),
            stock_quantity INTEGER NOT NULL CHECK (stock_quantity >= 0),
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
        )"#,
        )
        .await?;
        sql(manager, r#"CREATE TABLE IF NOT EXISTS order_items (
            id BIGSERIAL PRIMARY KEY,
            order_id VARCHAR NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
            product_id VARCHAR NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
            product_name VARCHAR NOT NULL, unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents >= 0),
            quantity INTEGER NOT NULL CHECK (quantity > 0),
            created_at TIMESTAMPTZ NOT NULL,
            UNIQUE(order_id, product_id)
        )"#).await?;
        sql(
            manager,
            "CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)",
        )
        .await?;
        sql(
            manager,
            "CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id)",
        )
        .await?;
        sql(
            manager,
            r#"INSERT INTO products
            (product_id,name,price_cents,stock_quantity,is_active,created_at,updated_at) VALUES
            ('PROD-001','星舟优选智能手环 Pro',19900,1000,true,NOW(),NOW()),
            ('PROD-002','星际降噪耳机 Pro',39900,1000,true,NOW(),NOW()),
            ('PROD-003','智能运动手表',59900,1000,true,NOW(),NOW()),
            ('PROD-004','便携蓝牙音箱',25900,1000,true,NOW(),NOW()),
            ('PROD-005','快充移动电源',12900,1000,true,NOW(),NOW())
            ON CONFLICT(product_id) DO NOTHING"#,
        )
        .await?;
        sql(
            manager,
            r#"INSERT INTO order_items
            (order_id,product_id,product_name,unit_price_cents,quantity,created_at)
            SELECT o.order_id,p.product_id,p.name,p.price_cents,1,NOW()
            FROM orders o JOIN products p
              ON p.product_id = 'PROD-' || LPAD((((o.id - 1) % 5) + 1)::text,3,'0')
            ON CONFLICT(order_id,product_id) DO NOTHING"#,
        )
        .await?;
        sql(manager, r#"UPDATE products p SET stock_quantity = GREATEST(
            0, 1000 - COALESCE((SELECT SUM(quantity) FROM order_items oi WHERE oi.product_id=p.product_id),0)
        ), updated_at=NOW() WHERE product_id LIKE 'PROD-00%'"#).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        sql(manager, "DROP TABLE IF EXISTS order_items").await?;
        sql(manager, "DROP TABLE IF EXISTS products").await
    }
}
