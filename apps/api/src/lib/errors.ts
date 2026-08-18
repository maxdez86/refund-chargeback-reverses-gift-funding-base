export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode = 500,
    readonly code?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}
