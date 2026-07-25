//! 用例：为当前用户新增订单。

use std::sync::Arc;

use chrono::{DateTime, Utc};

use crate::domain::auth::AuthUser;
use crate::domain::order::{status_text, NewOrder, NewOrderItem, OrderView};
use crate::domain::repository::OrderRepository;

use super::error::ApplicationError;

#[derive(Debug)]
pub struct CreateOrderCommand {
    pub order_id: String,
    pub status: String,
    pub carrier: Option<String>,
    pub tracking_number: Option<String>,
    pub estimated_delivery_at: Option<DateTime<Utc>>,
    pub items: Vec<NewOrderItem>,
}

pub struct CreateOrder {
    repo: Arc<dyn OrderRepository>,
}

impl CreateOrder {
    pub fn new(repo: Arc<dyn OrderRepository>) -> Self {
        Self { repo }
    }

    pub async fn execute(
        &self,
        auth: &AuthUser,
        command: CreateOrderCommand,
    ) -> Result<OrderView, ApplicationError> {
        let order_id = command.order_id.trim().to_uppercase();
        if !(3..=64).contains(&order_id.len())
            || !order_id
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || "-_".contains(character))
        {
            return Err(ApplicationError::InvalidRequest);
        }

        let status = command.status.trim().to_string();
        let Some(status_label) = status_text(&status) else {
            return Err(ApplicationError::InvalidRequest);
        };
        let normalize_optional = |value: Option<String>| {
            value
                .map(|text| text.trim().to_string())
                .filter(|text| !text.is_empty())
        };
        let items = command
            .items
            .into_iter()
            .map(|item| NewOrderItem {
                product_id: item.product_id.trim().to_uppercase(),
                quantity: item.quantity,
            })
            .collect();
        let order = NewOrder {
            order_id,
            status,
            status_text: status_label.to_string(),
            carrier: normalize_optional(command.carrier),
            tracking_number: normalize_optional(command.tracking_number),
            estimated_delivery_at: command.estimated_delivery_at,
            updated_at: Utc::now(),
            items,
        };
        if order.items.is_empty()
            || order.items.len() > 20
            || order
                .items
                .iter()
                .any(|i| i.quantity < 1 || i.quantity > 99 || i.product_id.trim().is_empty())
        {
            return Err(ApplicationError::InvalidRequest);
        }
        let mut ids = order
            .items
            .iter()
            .map(|item| item.product_id.as_str())
            .collect::<Vec<_>>();
        ids.sort_unstable();
        ids.dedup();
        if ids.len() != order.items.len() {
            return Err(ApplicationError::ProductConflict);
        }

        if !self.repo.create_owned(&auth.user_id, &order).await? {
            return Err(ApplicationError::Conflict);
        }

        self.repo
            .find_owned(&order.order_id, &auth.user_id)
            .await?
            .map(|o| o.into_view())
            .ok_or_else(|| ApplicationError::Internal("created order missing".into()))
    }
}
