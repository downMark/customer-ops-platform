//! 数据库连接。Neon PostgreSQL（TLS）；Lambda 场景连 -pooler 端点并用小池，
//! 关闭 sqlx_logging 避免打出 SQL 参数（脱敏）。

use std::time::Duration;

use sea_orm::{ConnectOptions, Database, DatabaseConnection, DbErr};

use crate::config::Config;

pub async fn connect(cfg: &Config) -> Result<DatabaseConnection, DbErr> {
    let mut opt = ConnectOptions::new(cfg.database_url.clone());
    opt.max_connections(cfg.db_max_connections)
        .connect_timeout(Duration::from_secs(cfg.db_connect_timeout_secs))
        .acquire_timeout(Duration::from_secs(cfg.db_connect_timeout_secs))
        .sqlx_logging(false);
    Database::connect(opt).await
}
