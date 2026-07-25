use super::error::ApplicationError;
use crate::domain::{
    auth::AuthUser,
    product::{Product, ProductPageView, ProductView},
    repository::ProductRepository,
};
use chrono::Utc;
use std::sync::Arc;

pub struct Products {
    repo: Arc<dyn ProductRepository>,
}
impl Products {
    pub fn new(repo: Arc<dyn ProductRepository>) -> Self {
        Self { repo }
    }
    pub async fn list(
        &self,
        page: u64,
        page_size: u64,
        keyword: Option<String>,
        active: Option<bool>,
    ) -> Result<ProductPageView, ApplicationError> {
        if page == 0 || page_size == 0 || page_size > 100 {
            return Err(ApplicationError::InvalidRequest);
        }
        let keyword = keyword
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        let (items, total) = self
            .repo
            .list(
                keyword.as_deref(),
                active,
                (page - 1) * page_size,
                page_size,
            )
            .await?;
        Ok(ProductPageView {
            items: items.into_iter().map(Into::into).collect(),
            total,
            page,
            page_size,
            total_pages: total.div_ceil(page_size),
        })
    }
    pub async fn create(
        &self,
        auth: &AuthUser,
        product_id: String,
        name: String,
        price_cents: i64,
        stock_quantity: i32,
    ) -> Result<ProductView, ApplicationError> {
        if auth.role != "admin" {
            return Err(ApplicationError::AdminRequired);
        }
        let product_id = product_id.trim().to_uppercase();
        let name = name.trim().to_string();
        if !(3..=64).contains(&product_id.len())
            || name.is_empty()
            || price_cents < 0
            || stock_quantity < 0
        {
            return Err(ApplicationError::InvalidRequest);
        }
        let now = Utc::now();
        let p = Product {
            product_id,
            name,
            price_cents,
            stock_quantity,
            is_active: true,
            created_at: now,
            updated_at: now,
        };
        if !self.repo.create(&p).await? {
            return Err(ApplicationError::ProductConflict);
        }
        Ok(p.into())
    }
}
