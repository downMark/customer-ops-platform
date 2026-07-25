import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { ORDER_STATUS_OPTIONS } from "apis/model/order";
import OrderService from "apis/services/Order";
import ProductService from "apis/services/Product";
import { DateTimePicker } from "@/components/DateTimePicker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createOrderSchema,
  type CreateOrderFormValues,
} from "@/forms/schemas";

const formatMoney = (cents: number) =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
  }).format(cents / 100);

const CreateOrder = () => {
  const queryClient = useQueryClient();
  const productsQuery = useQuery({
    queryKey: ["products", "active-order-options"],
    queryFn: () => ProductService.list(1, 100, "", true),
    retry: false,
  });
  const products = productsQuery.data?.items ?? [];
  const schema = useMemo(() => createOrderSchema(products), [products]);
  const form = useForm<CreateOrderFormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: {
      orderId: "",
      status: "pending_payment",
      items: [{ productId: "", quantity: 1 }],
      carrier: "",
      trackingNumber: "",
      estimatedDeliveryDate: undefined,
      estimatedDeliveryTime: "",
    },
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  });
  const items = form.watch("items");
  const selectedIds = items.map((item) => item.productId).filter(Boolean);

  const totalAmountCents = useMemo(
    () =>
      items.reduce((total, item) => {
        const product = products.find(
          (candidate) => candidate.productId === item.productId,
        );
        return total + (product?.priceCents ?? 0) * (item.quantity || 0);
      }, 0),
    [items, products],
  );

  const mutation = useMutation({
    mutationFn: (values: CreateOrderFormValues) => {
      let estimatedDeliveryAt: string | undefined;
      if (
        values.estimatedDeliveryDate &&
        values.estimatedDeliveryTime
      ) {
        const [hours, minutes] = values.estimatedDeliveryTime
          .split(":")
          .map(Number);
        const selectedDate = values.estimatedDeliveryDate;
        estimatedDeliveryAt = new Date(
          selectedDate.getFullYear(),
          selectedDate.getMonth(),
          selectedDate.getDate(),
          hours,
          minutes,
        ).toISOString();
      }
      return OrderService.createOrder({
        orderId: values.orderId.trim().toUpperCase(),
        status: values.status,
        items: values.items.map((item) => ({
          productId: item.productId!,
          quantity: item.quantity!,
        })),
        carrier: values.carrier.trim() || undefined,
        trackingNumber: values.trackingNumber.trim() || undefined,
        estimatedDeliveryAt,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });

  const submit = (values: CreateOrderFormValues) => mutation.mutate(values);
  const itemListError = (
    form.formState.errors.items as { message?: string } | undefined
  )?.message;

  return (
    <div className="h-full overflow-y-auto bg-surface-container-low">
      <div className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-10">
        <div className="mb-5 sm:mb-6">
          <p className="text-sm font-bold text-primary">订单管理</p>
          <h1 className="mt-1 text-2xl font-bold text-on-surface sm:text-3xl">
            添加订单
          </h1>
          <p className="mt-2 text-sm text-on-surface-variant sm:text-base">
            选择商品和数量，价格将以当前商品价格写入订单快照。
          </p>
        </div>

        <Card>
          <CardContent className="p-4 sm:p-6">
            <form
              noValidate
              onSubmit={form.handleSubmit(submit)}
              className="grid gap-6"
            >
              <div className="grid gap-5 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="order-id">
                    订单号 <span className="text-error">*</span>
                  </FieldLabel>
                  <Input
                    id="order-id"
                    placeholder="例如 ORD-2026-0001"
                    className="uppercase"
                    aria-invalid={Boolean(form.formState.errors.orderId)}
                    {...form.register("orderId")}
                  />
                  <FieldError errors={[form.formState.errors.orderId]} />
                </Field>

                <Field>
                  <FieldLabel htmlFor="create-order-status">
                    订单状态 <span className="text-error">*</span>
                  </FieldLabel>
                  <Controller
                    name="status"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger
                            id="create-order-status"
                            aria-invalid={fieldState.invalid}
                          >
                            <SelectValue placeholder="选择订单状态" />
                          </SelectTrigger>
                          <SelectContent>
                            {ORDER_STATUS_OPTIONS.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FieldError errors={[fieldState.error]} />
                      </>
                    )}
                  />
                </Field>
              </div>

              <section className="rounded-xl border border-border p-3 sm:p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-bold">商品明细</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      每个订单可添加 1–20 种商品。
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={fields.length >= 20}
                    onClick={() => append({ productId: "", quantity: 1 })}
                    className="w-full sm:w-auto"
                  >
                    添加商品
                  </Button>
                </div>

                {productsQuery.error && (
                  <Alert variant="destructive" className="mt-4">
                    <AlertDescription>
                      {(productsQuery.error as Error).message}
                    </AlertDescription>
                  </Alert>
                )}

                <div className="mt-4 space-y-3">
                  {fields.map((itemField, index) => {
                    const selectedProduct = products.find(
                      (candidate) =>
                        candidate.productId === items[index]?.productId,
                    );
                    return (
                      <div
                        key={itemField.id}
                        className="grid min-w-0 gap-3 rounded-xl bg-muted p-3 md:grid-cols-[minmax(0,1fr)_120px_140px_auto]"
                      >
                        <Field>
                          <FieldLabel htmlFor={`order-product-${index}`}>
                            商品
                          </FieldLabel>
                          <Controller
                            name={`items.${index}.productId`}
                            control={form.control}
                            render={({ field, fieldState }) => (
                              <>
                                <Select
                                  value={field.value}
                                  onValueChange={field.onChange}
                                  disabled={productsQuery.isPending}
                                >
                                  <SelectTrigger
                                    id={`order-product-${index}`}
                                    aria-invalid={fieldState.invalid}
                                  >
                                    <SelectValue
                                      placeholder={
                                        productsQuery.isPending
                                          ? "正在加载商品…"
                                          : "请选择商品"
                                      }
                                    />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {products.map((option) => (
                                      <SelectItem
                                        key={option.productId}
                                        value={option.productId}
                                        disabled={
                                          option.productId !== field.value &&
                                          selectedIds.includes(option.productId)
                                        }
                                      >
                                        {option.name}（库存{" "}
                                        {option.stockQuantity}）
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FieldError errors={[fieldState.error]} />
                              </>
                            )}
                          />
                        </Field>

                        <Field>
                          <FieldLabel htmlFor={`order-quantity-${index}`}>
                            数量
                          </FieldLabel>
                          <Controller
                            name={`items.${index}.quantity`}
                            control={form.control}
                            render={({ field, fieldState }) => (
                              <>
                                <Input
                                  id={`order-quantity-${index}`}
                                  type="number"
                                  min={1}
                                  max={99}
                                  step={1}
                                  inputMode="numeric"
                                  value={field.value}
                                  onChange={(event) =>
                                    field.onChange(
                                      event.target.value === ""
                                        ? Number.NaN
                                        : Number(event.target.value),
                                    )
                                  }
                                  aria-invalid={fieldState.invalid}
                                />
                                <FieldError errors={[fieldState.error]} />
                              </>
                            )}
                          />
                        </Field>

                        <div>
                          <p className="mb-2 text-sm font-semibold">小计</p>
                          <p className="py-2 font-bold">
                            {formatMoney(
                              (selectedProduct?.priceCents ?? 0) *
                                (items[index]?.quantity || 0),
                            )}
                          </p>
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          disabled={fields.length === 1}
                          onClick={() => remove(index)}
                          className="self-end text-error hover:bg-error-container hover:text-error"
                        >
                          删除
                        </Button>
                      </div>
                    );
                  })}
                </div>

                {itemListError && (
                  <FieldError className="mt-3">{itemListError}</FieldError>
                )}

                <div className="mt-4 flex flex-wrap items-center justify-end border-t border-border pt-4 text-base sm:text-lg">
                  订单总金额：
                  <strong className="ml-2 text-primary">
                    {formatMoney(totalAmountCents)}
                  </strong>
                </div>
              </section>

              <div className="grid gap-5 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="order-carrier">承运商</FieldLabel>
                  <Input
                    id="order-carrier"
                    placeholder="例如 顺丰速运"
                    {...form.register("carrier")}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="order-tracking-number">
                    运单号
                  </FieldLabel>
                  <Input
                    id="order-tracking-number"
                    placeholder="尚未生成时可留空"
                    {...form.register("trackingNumber")}
                  />
                </Field>

                <Field className="md:col-span-2">
                  <FieldLabel>预计送达时间</FieldLabel>
                  <Controller
                    name="estimatedDeliveryDate"
                    control={form.control}
                    render={({ field: dateField, fieldState: dateState }) => (
                      <Controller
                        name="estimatedDeliveryTime"
                        control={form.control}
                        render={({ field: timeField, fieldState: timeState }) => (
                          <>
                            <DateTimePicker
                              date={dateField.value}
                              time={timeField.value}
                              onDateChange={dateField.onChange}
                              onTimeChange={timeField.onChange}
                              disabled={mutation.isPending}
                              invalid={dateState.invalid || timeState.invalid}
                            />
                            <FieldError
                              errors={[dateState.error, timeState.error]}
                            />
                          </>
                        )}
                      />
                    )}
                  />
                  <FieldDescription>
                    日期和时间均填写后才会随订单提交。
                  </FieldDescription>
                </Field>
              </div>

              {mutation.error && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {(mutation.error as Error).message}
                  </AlertDescription>
                </Alert>
              )}

              {mutation.data && (
                <Alert variant="success">
                  <AlertDescription>
                    订单 {mutation.data.orderId} 已添加成功。
                    <Button asChild variant="link" className="ml-1 h-auto p-0">
                      <Link to="/orders">查看订单列表</Link>
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-1 gap-3 sm:flex">
                <Button
                  type="submit"
                  size="lg"
                  disabled={
                    mutation.isPending ||
                    productsQuery.isPending ||
                    Boolean(mutation.data)
                  }
                  className="w-full sm:w-auto"
                >
                  {mutation.isPending ? "正在保存…" : "保存订单"}
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="w-full sm:w-auto"
                >
                  <Link to="/orders">返回列表</Link>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CreateOrder;
