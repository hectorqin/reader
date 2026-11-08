export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST') => new AppError(400, code, message);

export class RateLimitError extends AppError {
  constructor(readonly retryAfter: number, code = 'AUTH_RATE_LIMITED') {
    super(429, code, '请求过于频繁，请稍后重试');
  }
}
export const unauthorized = (message = 'unauthorized', code = 'UNAUTHORIZED') => new AppError(401, code, message);
export const forbidden = (message = 'forbidden', code = 'FORBIDDEN') => new AppError(403, code, message);
export const notFound = (message = 'not found', code = 'NOT_FOUND') => new AppError(404, code, message);
export const conflict = (message: string, code = 'CONFLICT') => new AppError(409, code, message);
