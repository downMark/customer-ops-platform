import { z } from "zod";

export const knowledgeFiltersSchema = z.object({
  productId: z.string().trim().min(1).max(64).optional(),
  category: z.string().trim().min(1).max(64).optional(),
  source: z.string().trim().min(1).max(512).optional(),
});

export const knowledgeSearchRequestSchema = z.object({
  vector: z.array(z.number().finite()).length(1024),
  topK: z.number().int().min(1).max(50),
  filters: knowledgeFiltersSchema.optional(),
});

export const knowledgeChunkSchema = z.object({
  id: z.number().int(),
  documentId: z.string(),
  chunkIndex: z.number().int().nonnegative(),
  content: z.string(),
  source: z.string(),
  metadata: z.record(z.unknown()),
  score: z.number(),
});

export const knowledgeSearchResponseSchema = z.object({
  items: z.array(knowledgeChunkSchema),
});

export type KnowledgeFilters = z.infer<typeof knowledgeFiltersSchema>;
export type KnowledgeChunk = z.infer<typeof knowledgeChunkSchema>;
export type KnowledgeSearchRequest = z.infer<typeof knowledgeSearchRequestSchema>;

export type KnowledgeReference = KnowledgeChunk & {
  rerankScore: number;
};
