use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Debug, Clone)]
pub struct Product {
    pub product_id: String,
    pub name: String,
    pub price_cents: i64,
    pub stock_quantity: i32,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductView {
    pub product_id: String,
    pub name: String,
    pub price_cents: i64,
    pub stock_quantity: i32,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
impl From<Product> for ProductView {
    fn from(p: Product) -> Self {
        Self {
            product_id: p.product_id,
            name: p.name,
            price_cents: p.price_cents,
            stock_quantity: p.stock_quantity,
            is_active: p.is_active,
            created_at: p.created_at,
            updated_at: p.updated_at,
        }
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductPageView {
    pub items: Vec<ProductView>,
    pub total: u64,
    pub page: u64,
    pub page_size: u64,
    pub total_pages: u64,
}
