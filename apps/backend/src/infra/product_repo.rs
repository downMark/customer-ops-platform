use crate::domain::product::Product;
use crate::domain::repository::{ProductRepository, RepoError};
use crate::infra::entity::products;
use crate::infra::error::map_db_err;
use async_trait::async_trait;
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseBackend, DatabaseConnection, EntityTrait, PaginatorTrait,
    QueryFilter, QueryOrder, QuerySelect, Statement,
};

pub struct SeaOrmProductRepository {
    db: DatabaseConnection,
}
impl SeaOrmProductRepository {
    pub fn new(db: DatabaseConnection) -> Self {
        Self { db }
    }
}
fn convert(p: products::Model) -> Product {
    Product {
        product_id: p.product_id,
        name: p.name,
        price_cents: p.price_cents,
        stock_quantity: p.stock_quantity,
        is_active: p.is_active,
        created_at: p.created_at,
        updated_at: p.updated_at,
    }
}
#[async_trait]
impl ProductRepository for SeaOrmProductRepository {
    async fn list(
        &self,
        keyword: Option<&str>,
        active: Option<bool>,
        offset: u64,
        limit: u64,
    ) -> Result<(Vec<Product>, u64), RepoError> {
        let mut q = products::Entity::find();
        if let Some(k) = keyword {
            q = q.filter(
                products::Column::Name
                    .contains(k)
                    .or(products::Column::ProductId.contains(k)),
            );
        }
        if let Some(a) = active {
            q = q.filter(products::Column::IsActive.eq(a));
        }
        let total = q.clone().count(&self.db).await.map_err(map_db_err)?;
        let rows = q
            .order_by_asc(products::Column::ProductId)
            .offset(offset)
            .limit(limit)
            .all(&self.db)
            .await
            .map_err(map_db_err)?;
        Ok((rows.into_iter().map(convert).collect(), total))
    }
    async fn create(&self, product: &Product) -> Result<bool, RepoError> {
        let result = self
            .db
            .execute(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"INSERT INTO products
                   (product_id, name, price_cents, stock_quantity, is_active, created_at, updated_at)
                   VALUES ($1, $2, $3, $4, TRUE, $5, $6)
                   ON CONFLICT (product_id) DO NOTHING"#,
                [
                    product.product_id.clone().into(),
                    product.name.clone().into(),
                    product.price_cents.into(),
                    product.stock_quantity.into(),
                    product.created_at.into(),
                    product.updated_at.into(),
                ],
            ))
            .await
            .map_err(map_db_err)?;
        Ok(result.rows_affected() == 1)
    }
}
