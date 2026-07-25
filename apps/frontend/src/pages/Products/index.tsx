import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import ProductService from "apis/services/Product";
import { AppOutletContext } from "components/layout/AppShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  productFilterSchema,
  type ProductFilterValues,
} from "@/forms/schemas";

const money = (value: number) =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
  }).format(value / 100);

export default function Products() {
  const { session } = useOutletContext<AppOutletContext>();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const form = useForm<ProductFilterValues>({
    resolver: zodResolver(productFilterSchema),
    defaultValues: { keyword: "" },
  });
  const query = useQuery({
    queryKey: ["products", page, keyword],
    queryFn: () => ProductService.list(page, 10, keyword),
  });

  const submit = (values: ProductFilterValues) => {
    setPage(1);
    setKeyword(values.keyword.trim());
  };
  const isInitialLoading = query.isFetching && !query.data;

  return (
    <div className="h-full overflow-y-auto bg-surface-container-low">
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-10">
        <div className="mb-5 flex flex-col gap-4 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-bold text-primary">商品目录</p>
            <h1 className="text-2xl font-bold sm:text-3xl">商品管理</h1>
            <p className="mt-2 text-sm text-on-surface-variant sm:text-base">
              查看商品价格、库存和启用状态。
            </p>
          </div>
          {session.user.role === "admin" && (
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link to="/products/new">新增商品</Link>
            </Button>
          )}
        </div>

        <Card className="p-4">
          <form
            onSubmit={form.handleSubmit(submit)}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <Field className="min-w-0 flex-1">
              <FieldLabel htmlFor="product-keyword">
                商品编号或名称
              </FieldLabel>
              <Input
                id="product-keyword"
                placeholder="按商品编号或名称查询"
                {...form.register("keyword")}
              />
            </Field>
            <Button type="submit" disabled={query.isFetching}>
              {query.isFetching ? "查询中…" : "查询"}
            </Button>
          </form>
        </Card>

        {query.error && (
          <Alert variant="destructive" className="mt-5">
            <AlertDescription>
              {(query.error as Error).message}
            </AlertDescription>
          </Alert>
        )}

        <Card className="mt-6 overflow-hidden">
          {isInitialLoading ? (
            <div className="space-y-3 p-5" aria-label="正在加载商品">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader className="bg-surface-container-low">
                    <TableRow>
                      <TableHead>商品编号</TableHead>
                      <TableHead>商品名称</TableHead>
                      <TableHead>价格</TableHead>
                      <TableHead>库存</TableHead>
                      <TableHead>状态</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {query.data?.items.map((product) => (
                      <TableRow key={product.productId}>
                        <TableCell className="font-bold text-primary">
                          {product.productId}
                        </TableCell>
                        <TableCell>{product.name}</TableCell>
                        <TableCell>{money(product.priceCents)}</TableCell>
                        <TableCell>{product.stockQuantity}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              product.isActive ? "default" : "secondary"
                            }
                          >
                            {product.isActive ? "已启用" : "已停用"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="divide-y divide-border md:hidden">
                {query.data?.items.map((product) => (
                  <Item key={product.productId}>
                    <div className="flex items-start justify-between gap-3">
                      <ItemContent>
                        <ItemDescription className="break-all font-bold text-primary">
                          {product.productId}
                        </ItemDescription>
                        <ItemTitle className="mt-1">{product.name}</ItemTitle>
                      </ItemContent>
                      <Badge
                        variant={product.isActive ? "default" : "secondary"}
                        className="shrink-0"
                      >
                        {product.isActive ? "已启用" : "已停用"}
                      </Badge>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-muted p-3">
                      <div>
                        <dt className="text-xs text-muted-foreground">价格</dt>
                        <dd className="mt-1 font-bold">
                          {money(product.priceCents)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">库存</dt>
                        <dd className="mt-1 font-bold">
                          {product.stockQuantity}
                        </dd>
                      </div>
                    </dl>
                  </Item>
                ))}
              </div>

              {query.data?.items.length === 0 && (
                <Empty>
                  <EmptyTitle>没有找到商品</EmptyTitle>
                  <EmptyDescription>
                    请调整商品编号或名称后重新查询。
                  </EmptyDescription>
                </Empty>
              )}
            </>
          )}

          <div className="flex flex-col gap-3 border-t border-border p-4 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-muted-foreground">
              共 {query.data?.total ?? 0} 条
            </span>
            <Pagination className="w-full justify-end sm:w-auto">
              <PaginationContent className="grid w-full grid-cols-2 sm:flex sm:w-auto">
                <PaginationItem>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={page <= 1 || query.isFetching}
                    onClick={() => setPage((current) => current - 1)}
                    className="w-full"
                  >
                    上一页
                  </Button>
                </PaginationItem>
                <PaginationItem>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      query.isFetching ||
                      !query.data?.totalPages ||
                      page >= query.data.totalPages
                    }
                    onClick={() => setPage((current) => current + 1)}
                    className="w-full"
                  >
                    下一页
                  </Button>
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        </Card>
      </div>
    </div>
  );
}
