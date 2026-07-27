//! Neon/本地 PostgreSQL 的 migrate-only 入口。

use customer_ops_backend::{migrate_database, Config, StartupError};

#[tokio::main]
async fn main() -> Result<(), StartupError> {
    dotenvy::dotenv().ok();
    let config = Config::from_env()?;
    migrate_database(&config).await?;
    println!("database migrations applied");
    Ok(())
}
