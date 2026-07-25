//! 用例：分页查询当前用户的订单。

use std::sync::Arc;

use crate::domain::auth::AuthUser;
use crate::domain::order::{status_text, OrderFilter, OrderPageView};
use crate::domain::repository::OrderRepository;

use super::error::ApplicationError;

pub struct ListOrders {
    repo: Arc<dyn OrderRepository>,
}

impl ListOrders {
    pub fn new(repo: Arc<dyn OrderRepository>) -> Self {
        Self { repo }
    }

    pub async fn execute(
        &self,
        auth: &AuthUser,
        page: u64,
        page_size: u64,
        order_id: Option<String>,
        status: Option<String>,
    ) -> Result<OrderPageView, ApplicationError> {
        if page == 0 || page_size == 0 || page_size > 100 {
            return Err(ApplicationError::InvalidRequest);
        }

        let order_id = order_id
            .map(|value| value.trim().to_uppercase())
            .filter(|value| !value.is_empty());
        let status = status
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        if status
            .as_deref()
            .is_some_and(|value| status_text(value).is_none())
        {
            return Err(ApplicationError::InvalidRequest);
        }

        let filter = OrderFilter { order_id, status };
        let offset = (page - 1)
            .checked_mul(page_size)
            .ok_or(ApplicationError::InvalidRequest)?;
        let (orders, total) = self
            .repo
            .list_owned(&auth.user_id, &filter, offset, page_size)
            .await?;

        Ok(OrderPageView {
            items: orders.into_iter().map(|order| order.into_view()).collect(),
            total,
            page,
            page_size,
            total_pages: total.div_ceil(page_size),
        })
    }
}
