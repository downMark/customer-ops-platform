import { getApiBaseURL } from "../index";
import { CreateProductInput, Product, ProductPage } from "../model/product";
import AuthService from "./Auth";

interface Envelope<T> {
  success: boolean;
  msg: string;
  data: T | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = AuthService.getAccessToken();
  if (!token) throw new Error("登录状态已失效，请重新登录。");

  const response = await fetch(`${getApiBaseURL()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as Envelope<T> | null;
  if (!response.ok || !body?.success || body.data == null) {
    throw new Error(body?.msg || `商品服务暂时不可用 (${response.status})`);
  }
  return body.data;
}

export default class ProductService {
  static list(page = 1, pageSize = 100, keyword = "", active?: boolean) {
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (keyword) query.set("keyword", keyword);
    if (active !== undefined) query.set("active", String(active));
    return request<ProductPage>(`/api/products?${query}`);
  }

  static create(input: CreateProductInput) {
    return request<Product>("/api/products", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
}
