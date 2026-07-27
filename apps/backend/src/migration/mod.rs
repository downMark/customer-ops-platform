//! 内联 SeaORM migration，启动时 `Migrator::up` 应用待执行迁移。

use sea_orm_migration::prelude::*;

mod m20260722_000001_create_orders;
mod m20260722_000002_create_conversation_completions;
mod m20260723_000003_create_users;
mod m20260723_000004_seed_admin_orders;
mod m20260725_000005_create_products_and_order_items;
mod m20260727_000006_create_knowledge_chunks;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20260722_000001_create_orders::Migration),
            Box::new(m20260722_000002_create_conversation_completions::Migration),
            Box::new(m20260723_000003_create_users::Migration),
            Box::new(m20260723_000004_seed_admin_orders::Migration),
            Box::new(m20260725_000005_create_products_and_order_items::Migration),
            Box::new(m20260727_000006_create_knowledge_chunks::Migration),
        ]
    }
}
