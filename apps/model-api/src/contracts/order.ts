import { z } from "zod";

export const orderSchema = z.object({
  orderId: z.string().min(1),
  status: z.string().min(1),
  statusText: z.string().min(1),
  carrier: z.string().nullable().optional(),
  trackingNumber: z.string().nullable().optional(),
  estimatedDeliveryAt: z.string().datetime().nullable().optional(),
  updatedAt: z.string().datetime(),
});

export type Order = z.infer<typeof orderSchema>;
