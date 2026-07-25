import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { useState } from "react";
import OrderService from "apis/services/Order";
import { ORDER_STATUS_OPTIONS } from "apis/model/order";
import Icon from "components/Icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemDescription } from "@/components/ui/item";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  orderFilterSchema,
  type OrderFilterValues,
} from "@/forms/schemas";

const PAGE_SIZE = 10;

const formatMoney = (cents: number) =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
  }).format(cents / 100);

const displayTime = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const Orders = () => {
  const [filters, setFilters] = useState({ orderId: "", status: "" });
  const [page, setPage] = useState(1);
  const form = useForm<OrderFilterValues>({
    resolver: zodResolver(orderFilterSchema),
    defaultValues: { orderId: "", status: "" },
  });

  const { data, error, isFetching } = useQuery({
    queryKey: ["orders", page, filters.orderId, filters.status],
    queryFn: () =>
      OrderService.listOrders({
        page,
        pageSize: PAGE_SIZE,
        orderId: filters.orderId || undefined,
        status: filters.status || undefined,
      }),
    retry: false,
  });

  const submit = (values: OrderFilterValues) => {
    setPage(1);
    setFilters({
      orderId: values.orderId.trim().toUpperCase(),
      status: values.status === "all" ? "" : values.status,
    });
  };

  const reset = () => {
    form.reset();
    setFilters({ orderId: "", status: "" });
    setPage(1);
  };
  const isInitialLoading = isFetching && !data;

  return (
    <div className="h-full overflow-y-auto bg-surface-container-low">
      <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-10">
        <div className="mb-5 sm:mb-6">
          <p className="text-sm font-bold text-primary">订单管理</p>
          <h1 className="mt-1 text-2xl font-bold text-on-surface sm:text-3xl">
            订单数据
          </h1>
          <p className="mt-2 text-sm text-on-surface-variant sm:text-base">
            分页展示当前账号的订单，可按订单号和订单状态筛选。
          </p>
        </div>

        <Card className="p-4 sm:p-5">
          <form
            onSubmit={form.handleSubmit(submit)}
            className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px_auto]"
          >
            <Field>
              <FieldLabel htmlFor="order-search">订单号</FieldLabel>
              <span className="relative block">
                <Icon
                  name="search"
                  className="absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="order-search"
                  placeholder="输入完整或部分订单号"
                  className="pl-11 uppercase"
                  {...form.register("orderId")}
                />
              </span>
            </Field>

            <Field>
              <FieldLabel htmlFor="order-status-filter">订单状态</FieldLabel>
              <Controller
                name="status"
                control={form.control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="order-status-filter">
                      <SelectValue placeholder="全部状态" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部状态</SelectItem>
                      {ORDER_STATUS_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <div className="flex items-end gap-2">
              <Button
                type="submit"
                disabled={isFetching}
                className="flex-1 lg:flex-none"
              >
                {isFetching ? "查询中…" : "查询"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={reset}
                className="flex-1 lg:flex-none"
              >
                重置
              </Button>
            </div>
          </form>
        </Card>

        {error && (
          <Alert variant="destructive" className="mt-6">
            <AlertDescription>{(error as Error).message}</AlertDescription>
          </Alert>
        )}

        <Card className="mt-6 overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="font-bold">订单列表</h2>
            <span className="text-sm text-muted-foreground">
              共 {data?.total ?? 0} 条
            </span>
          </div>

          {isInitialLoading ? (
            <div className="space-y-3 p-5" aria-label="正在加载订单">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))}
            </div>
          ) : (
            <>
              <div className="hidden md:block">
                <Table className="min-w-[1100px]">
                  <TableHeader className="bg-surface-container-low">
                    <TableRow>
                      <TableHead>订单号</TableHead>
                      <TableHead>商品</TableHead>
                      <TableHead>订单金额</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>承运商</TableHead>
                      <TableHead>运单号</TableHead>
                      <TableHead>预计送达</TableHead>
                      <TableHead>更新时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data?.items.map((order) => (
                      <TableRow key={order.orderId}>
                        <TableCell className="font-bold text-primary">
                          {order.orderId}
                        </TableCell>
                        <TableCell className="max-w-72">
                          {order.productSummary || "暂无商品"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-bold">
                          {formatMoney(order.totalAmountCents)}
                        </TableCell>
                        <TableCell>
                          <Badge>{order.statusText}</Badge>
                        </TableCell>
                        <TableCell>{order.carrier || "尚未分配"}</TableCell>
                        <TableCell>
                          {order.trackingNumber || "尚未生成"}
                        </TableCell>
                        <TableCell>
                          {order.estimatedDeliveryAt
                            ? displayTime(order.estimatedDeliveryAt)
                            : "暂无"}
                        </TableCell>
                        <TableCell>{displayTime(order.updatedAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="divide-y divide-border md:hidden">
                {data?.items.map((order) => (
                  <Item key={order.orderId} className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <ItemContent>
                        <p className="break-all font-bold text-primary">
                          {order.orderId}
                        </p>
                        <ItemDescription className="mt-1">
                          {displayTime(order.updatedAt)}
                        </ItemDescription>
                      </ItemContent>
                      <Badge className="shrink-0">{order.statusText}</Badge>
                    </div>

                    <div className="rounded-xl bg-muted p-3">
                      <p className="text-xs font-semibold text-muted-foreground">
                        商品
                      </p>
                      <p className="mt-1 text-sm">
                        {order.productSummary || "暂无商品"}
                      </p>
                      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                        <span className="text-sm text-muted-foreground">
                          订单金额
                        </span>
                        <strong>{formatMoney(order.totalAmountCents)}</strong>
                      </div>
                    </div>

                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">承运商</dt>
                        <dd className="mt-1 break-words">
                          {order.carrier || "尚未分配"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">运单号</dt>
                        <dd className="mt-1 break-all">
                          {order.trackingNumber || "尚未生成"}
                        </dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-xs text-muted-foreground">
                          预计送达
                        </dt>
                        <dd className="mt-1">
                          {order.estimatedDeliveryAt
                            ? displayTime(order.estimatedDeliveryAt)
                            : "暂无"}
                        </dd>
                      </div>
                    </dl>
                  </Item>
                ))}
              </div>

              {data?.items.length === 0 && (
                <Empty>
                  <EmptyTitle>没有找到订单</EmptyTitle>
                  <EmptyDescription>
                    请调整订单号或状态筛选后重新查询。
                  </EmptyDescription>
                </Empty>
              )}
            </>
          )}

          <div className="flex flex-col gap-3 border-t border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <span className="text-sm text-muted-foreground">
              第 {data?.page ?? page} 页，共 {data?.totalPages ?? 0} 页
            </span>
            <Pagination className="w-full justify-end sm:w-auto">
              <PaginationContent className="grid w-full grid-cols-2 sm:flex sm:w-auto">
                <PaginationItem>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={page <= 1 || isFetching}
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
                      isFetching || !data?.totalPages || page >= data.totalPages
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
};

export default Orders;
