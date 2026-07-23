//! SeaORM 订单仓储实现。归属过滤下沉到 SQL；连接类错误映射为 Unavailable。

use async_trait::async_trait;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter};

use crate::domain::order::Order;
use crate::domain::repository::{OrderRepository, RepoError};
use crate::infra::entity::orders;
use crate::infra::error::map_db_err;

pub struct SeaOrmOrderRepository {
    db: DatabaseConnection,
}

impl SeaOrmOrderRepository {
    pub fn new(db: DatabaseConnection) -> Self {
        Self { db }
    }
}

#[async_trait]
impl OrderRepository for SeaOrmOrderRepository {
    async fn find_owned(&self, order_id: &str, user_id: &str) -> Result<Option<Order>, RepoError> {
        let model = orders::Entity::find()
            .filter(orders::Column::OrderId.eq(order_id))
            .filter(orders::Column::UserId.eq(user_id))
            .one(&self.db)
            .await
            .map_err(map_db_err)?;
        Ok(model.map(Order::from))
    }

    async fn exists(&self, order_id: &str) -> Result<bool, RepoError> {
        let count = orders::Entity::find()
            .filter(orders::Column::OrderId.eq(order_id))
            .count(&self.db)
            .await
            .map_err(map_db_err)?;
        Ok(count > 0)
    }
}
