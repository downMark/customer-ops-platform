//! 订单仓储 trait 与仓储错误。infra 层实现，application 层依赖。

use async_trait::async_trait;

use super::order::{NewOrder, Order, OrderFilter};
use super::product::Product;

/// 仓储层错误（对上层收敛为可用性/内部两类）。
#[derive(Debug)]
pub enum RepoError {
    /// 连接/超时等不可用类错误 → 上层映射 503，不猜测订单状态。
    Unavailable,
    /// 其他未预期错误，detail 仅用于日志。
    Other(String),
    InvalidReference,
    InsufficientStock,
}

#[async_trait]
pub trait ProductRepository: Send + Sync {
    async fn list(
        &self,
        keyword: Option<&str>,
        active: Option<bool>,
        offset: u64,
        limit: u64,
    ) -> Result<(Vec<Product>, u64), RepoError>;
    async fn create(&self, product: &Product) -> Result<bool, RepoError>;
}

#[async_trait]
pub trait OrderRepository: Send + Sync {
    /// 按订单号 + 归属用户查询（归属条件下沉到 SQL）。
    async fn find_owned(&self, order_id: &str, user_id: &str) -> Result<Option<Order>, RepoError>;

    /// 订单号是否存在（用于区分 404 未找到 / 403 无权）。
    async fn exists(&self, order_id: &str) -> Result<bool, RepoError>;

    /// 查询当前用户的订单列表，返回数据与总数。
    async fn list_owned(
        &self,
        user_id: &str,
        filter: &OrderFilter,
        offset: u64,
        limit: u64,
    ) -> Result<(Vec<Order>, u64), RepoError>;

    /// 新增当前用户的订单；订单号已存在时返回 false。
    async fn create_owned(&self, user_id: &str, order: &NewOrder) -> Result<bool, RepoError>;
}
