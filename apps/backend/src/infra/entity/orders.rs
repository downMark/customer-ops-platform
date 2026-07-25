//! `orders` 表实体。列与 migration 保持一致。

use sea_orm::entity::prelude::*;

use crate::domain::order::Order;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "orders")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    #[sea_orm(unique)]
    pub order_id: String,
    pub user_id: String,
    pub status: String,
    pub status_text: String,
    pub carrier: Option<String>,
    pub tracking_number: Option<String>,
    pub estimated_delivery_at: Option<DateTimeUtc>,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

impl From<Model> for Order {
    fn from(m: Model) -> Self {
        Order {
            order_id: m.order_id,
            status: m.status,
            status_text: m.status_text,
            carrier: m.carrier,
            tracking_number: m.tracking_number,
            estimated_delivery_at: m.estimated_delivery_at,
            updated_at: m.updated_at,
            items: Vec::new(),
        }
    }
}
