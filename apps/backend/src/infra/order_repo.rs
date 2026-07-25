//! SeaORM 订单仓储实现。归属过滤下沉到 SQL；连接类错误映射为 Unavailable。

use async_trait::async_trait;
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseBackend, DatabaseConnection, EntityTrait, PaginatorTrait,
    QueryFilter, QueryOrder, QuerySelect, Statement, TransactionTrait,
};
use std::collections::HashMap;

use crate::domain::order::{NewOrder, Order, OrderFilter, OrderItem};
use crate::domain::repository::{OrderRepository, RepoError};
use crate::infra::entity::{order_items, orders};
use crate::infra::error::map_db_err;

pub struct SeaOrmOrderRepository {
    db: DatabaseConnection,
}

impl SeaOrmOrderRepository {
    pub fn new(db: DatabaseConnection) -> Self {
        Self { db }
    }

    async fn attach_items(&self, mut values: Vec<Order>) -> Result<Vec<Order>, RepoError> {
        let ids = values
            .iter()
            .map(|o| o.order_id.clone())
            .collect::<Vec<_>>();
        if ids.is_empty() {
            return Ok(values);
        }
        let rows = order_items::Entity::find()
            .filter(order_items::Column::OrderId.is_in(ids))
            .order_by_asc(order_items::Column::Id)
            .all(&self.db)
            .await
            .map_err(map_db_err)?;
        let mut grouped: HashMap<String, Vec<OrderItem>> = HashMap::new();
        for row in rows {
            grouped.entry(row.order_id).or_default().push(OrderItem {
                product_id: row.product_id,
                product_name: row.product_name,
                unit_price_cents: row.unit_price_cents,
                quantity: row.quantity,
                subtotal_cents: row.unit_price_cents * i64::from(row.quantity),
            });
        }
        for order in &mut values {
            order.items = grouped.remove(&order.order_id).unwrap_or_default();
        }
        Ok(values)
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
        let Some(model) = model else { return Ok(None) };
        Ok(self.attach_items(vec![Order::from(model)]).await?.pop())
    }

    async fn exists(&self, order_id: &str) -> Result<bool, RepoError> {
        let count = orders::Entity::find()
            .filter(orders::Column::OrderId.eq(order_id))
            .count(&self.db)
            .await
            .map_err(map_db_err)?;
        Ok(count > 0)
    }

    async fn list_owned(
        &self,
        user_id: &str,
        filter: &OrderFilter,
        offset: u64,
        limit: u64,
    ) -> Result<(Vec<Order>, u64), RepoError> {
        let mut query =
            orders::Entity::find().filter(orders::Column::UserId.eq(user_id.to_string()));

        if let Some(order_id) = filter.order_id.as_deref() {
            query = query.filter(orders::Column::OrderId.contains(order_id));
        }
        if let Some(status) = filter.status.as_deref() {
            query = query.filter(orders::Column::Status.eq(status));
        }

        let total = query.clone().count(&self.db).await.map_err(map_db_err)?;
        let models = query
            .order_by_desc(orders::Column::UpdatedAt)
            .order_by_desc(orders::Column::Id)
            .offset(offset)
            .limit(limit)
            .all(&self.db)
            .await
            .map_err(map_db_err)?;

        let orders = self
            .attach_items(models.into_iter().map(Order::from).collect())
            .await?;
        Ok((orders, total))
    }

    async fn create_owned(&self, user_id: &str, order: &NewOrder) -> Result<bool, RepoError> {
        let txn = self.db.begin().await.map_err(map_db_err)?;
        let result = txn
            .execute(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"INSERT INTO orders
                    (order_id, user_id, status, status_text, carrier, tracking_number, estimated_delivery_at, updated_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                   ON CONFLICT (order_id) DO NOTHING"#,
                [
                    order.order_id.clone().into(),
                    user_id.to_string().into(),
                    order.status.clone().into(),
                    order.status_text.clone().into(),
                    order.carrier.clone().into(),
                    order.tracking_number.clone().into(),
                    order.estimated_delivery_at.into(),
                    order.updated_at.into(),
                ],
            ))
            .await
            .map_err(map_db_err)?;
        if result.rows_affected() != 1 {
            txn.rollback().await.map_err(map_db_err)?;
            return Ok(false);
        }
        for item in &order.items {
            let row = txn.query_one(Statement::from_sql_and_values(DatabaseBackend::Postgres,
                "UPDATE products SET stock_quantity=stock_quantity-$1,updated_at=NOW() WHERE product_id=$2 AND is_active=true AND stock_quantity >= $1 RETURNING name,price_cents",
                [item.quantity.into(),item.product_id.clone().into()])).await.map_err(map_db_err)?;
            let Some(row) = row else {
                let exists = txn
                    .query_one(Statement::from_sql_and_values(
                        DatabaseBackend::Postgres,
                        "SELECT 1 FROM products WHERE product_id=$1 AND is_active=true",
                        [item.product_id.clone().into()],
                    ))
                    .await
                    .map_err(map_db_err)?;
                let error = if exists.is_some() {
                    RepoError::InsufficientStock
                } else {
                    RepoError::InvalidReference
                };
                txn.rollback().await.map_err(map_db_err)?;
                return Err(error);
            };
            let name: String = row.try_get("", "name").map_err(map_db_err)?;
            let price: i64 = row.try_get("", "price_cents").map_err(map_db_err)?;
            txn.execute(Statement::from_sql_and_values(DatabaseBackend::Postgres,
                "INSERT INTO order_items(order_id,product_id,product_name,unit_price_cents,quantity,created_at) VALUES($1,$2,$3,$4,$5,NOW())",
                [order.order_id.clone().into(),item.product_id.clone().into(),name.into(),price.into(),item.quantity.into()])).await.map_err(map_db_err)?;
        }
        txn.commit().await.map_err(map_db_err)?;
        Ok(true)
    }
}
