export interface Product {
  productId: string;
  name: string;
  priceCents: number;
  stockQuantity: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductPage {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CreateProductInput {
  productId: string;
  name: string;
  priceCents: number;
  stockQuantity: number;
}
