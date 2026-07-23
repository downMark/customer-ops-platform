//! customer-ops-backend 本地 Axum 入口。

#[tokio::main]
async fn main() -> Result<(), customer_ops_backend::StartupError> {
    customer_ops_backend::run().await
}
