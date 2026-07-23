import { z } from "zod";

export const loginRequestSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
});

export const loginResultSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal("Bearer"),
  expiresIn: z.number().int().positive(),
  user: z.object({
    userId: z.string().min(1),
    username: z.string().min(1),
    role: z.string().min(1),
  }),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type LoginResult = z.infer<typeof loginResultSchema>;
