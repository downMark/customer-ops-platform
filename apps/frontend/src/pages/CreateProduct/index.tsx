import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useOutletContext } from "react-router-dom";
import ProductService from "apis/services/Product";
import { AppOutletContext } from "components/layout/AppShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  productSchema,
  type ProductFormValues,
} from "@/forms/schemas";

export default function CreateProduct() {
  const { session } = useOutletContext<AppOutletContext>();
  const queryClient = useQueryClient();
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: { productId: "", name: "", price: "", stock: "0" },
  });
  const mutation = useMutation({
    mutationFn: (values: ProductFormValues) =>
      ProductService.create({
        productId: values.productId.trim().toUpperCase(),
        name: values.name.trim(),
        priceCents: Math.round(Number(values.price) * 100),
        stockQuantity: Number(values.stock),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["products"] }),
  });

  if (session.user.role !== "admin") {
    return (
      <div className="h-full bg-surface-container-low p-4 sm:p-10">
        <Alert variant="destructive" className="mx-auto max-w-3xl p-5 sm:p-6">
          <AlertTitle className="text-xl">无权新增商品</AlertTitle>
          <AlertDescription>只有管理员可以新增商品。</AlertDescription>
          <Button asChild variant="link" className="mt-2 px-0">
            <Link to="/products">返回商品列表</Link>
          </Button>
        </Alert>
      </div>
    );
  }

  const submit = async (values: ProductFormValues) => {
    await mutation.mutateAsync(values);
  };

  return (
    <div className="h-full overflow-y-auto bg-surface-container-low">
      <div className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-10">
        <p className="font-bold text-primary">商品目录</p>
        <h1 className="mb-5 text-2xl font-bold sm:mb-6 sm:text-3xl">
          新增商品
        </h1>
        <Card>
          <CardContent className="p-4 sm:p-6">
            <form
              noValidate
              onSubmit={form.handleSubmit(submit)}
              className="grid gap-5 md:grid-cols-2"
            >
              <Field>
                <FieldLabel htmlFor="product-id">商品编号</FieldLabel>
                <Input
                  id="product-id"
                  placeholder="例如 PROD-006"
                  className="uppercase"
                  aria-invalid={Boolean(form.formState.errors.productId)}
                  {...form.register("productId")}
                />
                <FieldError errors={[form.formState.errors.productId]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="product-name">商品名称</FieldLabel>
                <Input
                  id="product-name"
                  aria-invalid={Boolean(form.formState.errors.name)}
                  {...form.register("name")}
                />
                <FieldError errors={[form.formState.errors.name]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="product-price">销售价格（元）</FieldLabel>
                <Input
                  id="product-price"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  aria-invalid={Boolean(form.formState.errors.price)}
                  {...form.register("price")}
                />
                <FieldError errors={[form.formState.errors.price]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="product-stock">初始库存</FieldLabel>
                <Input
                  id="product-stock"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  aria-invalid={Boolean(form.formState.errors.stock)}
                  {...form.register("stock")}
                />
                <FieldError errors={[form.formState.errors.stock]} />
              </Field>

              {mutation.error && (
                <Alert variant="destructive" className="md:col-span-2">
                  <AlertDescription>
                    {(mutation.error as Error).message}
                  </AlertDescription>
                </Alert>
              )}
              {mutation.data && (
                <Alert variant="success" className="md:col-span-2">
                  <AlertDescription>
                    商品 {mutation.data.productId} 已新增成功。
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid gap-3 sm:flex md:col-span-2">
                <Button
                  type="submit"
                  size="lg"
                  disabled={mutation.isPending || Boolean(mutation.data)}
                  className="w-full sm:w-auto"
                >
                  {mutation.isPending ? "正在保存…" : "保存商品"}
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="w-full sm:w-auto"
                >
                  <Link to="/products">返回列表</Link>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
