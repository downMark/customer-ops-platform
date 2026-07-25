import { z } from "zod";
import { ORDER_STATUS_OPTIONS } from "@/apis/model/order";
import type { Product } from "@/apis/model/product";

export const loginSchema = z.object({
  username: z.string().trim().min(1, "请输入用户名"),
  password: z.string().min(1, "请输入密码"),
});

export type LoginFormValues = z.infer<typeof loginSchema>;

export const productSchema = z.object({
  productId: z
    .string()
    .trim()
    .min(3, "商品编号至少需要 3 个字符")
    .max(64, "商品编号不能超过 64 个字符"),
  name: z.string().trim().min(1, "请输入商品名称"),
  price: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,2})?$/, "请输入最多两位小数的非负价格"),
  stock: z
    .string()
    .trim()
    .regex(/^\d+$/, "库存必须是非负整数"),
});

export type ProductFormValues = z.infer<typeof productSchema>;

const orderItemSchema = z.object({
  productId: z.string().min(1, "请选择商品"),
  quantity: z
    .number({ invalid_type_error: "请输入数量" })
    .int("数量必须是整数")
    .min(1, "数量不能少于 1")
    .max(99, "数量不能超过 99"),
});

export const createOrderSchema = (products: Product[]) =>
  z
    .object({
      orderId: z
        .string()
        .trim()
        .min(3, "订单号至少需要 3 个字符")
        .max(64, "订单号不能超过 64 个字符")
        .regex(
          /^[A-Za-z0-9_-]+$/,
          "订单号只能包含字母、数字、短横线和下划线",
        ),
      status: z.string().refine(
        (value) =>
          ORDER_STATUS_OPTIONS.some((option) => option.value === value),
        "请选择有效的订单状态",
      ),
      items: z
        .array(orderItemSchema)
        .min(1, "至少添加一种商品")
        .max(20, "每个订单最多添加 20 种商品"),
      carrier: z.string(),
      trackingNumber: z.string(),
      estimatedDeliveryDate: z.date().optional(),
      estimatedDeliveryTime: z.string(),
    })
    .superRefine((values, context) => {
      const selectedIds = values.items.map((item) => item.productId);
      if (new Set(selectedIds).size !== selectedIds.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items"],
          message: "同一订单不能重复选择商品",
        });
      }
      values.items.forEach((item, index) => {
        const product = products.find(
          (candidate) => candidate.productId === item.productId,
        );
        if (product && item.quantity > product.stockQuantity) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["items", index, "quantity"],
            message: `当前库存仅剩 ${product.stockQuantity} 件`,
          });
        }
      });
      const hasDate = Boolean(values.estimatedDeliveryDate);
      const hasTime = Boolean(values.estimatedDeliveryTime);
      if (hasDate !== hasTime) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [
            hasDate ? "estimatedDeliveryTime" : "estimatedDeliveryDate",
          ],
          message: hasDate ? "请选择时间" : "请选择日期",
        });
      }
    });

export type CreateOrderFormValues = z.infer<
  ReturnType<typeof createOrderSchema>
>;

export const orderFilterSchema = z.object({
  orderId: z.string(),
  status: z.string(),
});

export type OrderFilterValues = z.infer<typeof orderFilterSchema>;

export const productFilterSchema = z.object({
  keyword: z.string(),
});

export type ProductFilterValues = z.infer<typeof productFilterSchema>;
