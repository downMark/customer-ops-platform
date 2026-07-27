export type PublicErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "ORDER_NOT_FOUND"
  | "ORDER_ACCESS_DENIED"
  | "ORDER_SERVICE_UNAVAILABLE"
  | "KNOWLEDGE_SERVICE_UNAVAILABLE"
  | "MODEL_UNAVAILABLE"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    public readonly code: PublicErrorCode,
    message: string,
    public readonly status: number,
    public readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AppError";
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError(
    "INTERNAL_ERROR",
    "服务暂时不可用，请稍后重试",
    500,
    true,
    { cause: error },
  );
}
