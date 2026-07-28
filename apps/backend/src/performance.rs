use std::env;
use std::sync::OnceLock;

use customer_ops_performance::PerformanceClient;

static CLIENT: OnceLock<PerformanceClient> = OnceLock::new();

pub fn client() -> &'static PerformanceClient {
    CLIENT.get_or_init(|| {
        PerformanceClient::new(
            "backend",
            env::var("APP_ENVIRONMENT").unwrap_or_else(|_| "local".into()),
            env::var("APP_RELEASE").unwrap_or_else(|_| "development".into()),
        )
    })
}
