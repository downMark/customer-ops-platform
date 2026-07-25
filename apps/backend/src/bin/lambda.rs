//! AWS Lambda HTTP 入口。
//!
//! 依赖只在启用 `lambda` feature 时编译；应用装配和 Router 与本地服务复用。

use customer_ops_backend::{build_app, Config};
use lambda_http::{run, tracing, Error};

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing::init_default_subscriber();

    let config = Config::from_env()?;
    let app = build_app(&config).await?;

    run(app).await
}
