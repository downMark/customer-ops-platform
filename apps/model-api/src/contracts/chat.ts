import { z } from "zod";

export const chatRequestSchema = z.object({
  conversationId: z.string().trim().min(1).max(128),
  orderId: z.string().trim().min(1).max(64).optional(),
  message: z.string().trim().min(1).max(4_000),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;
