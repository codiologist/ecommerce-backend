export type ErrorDetail = { path?: string; message: string };

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: ErrorDetail[] | undefined;
  readonly expose: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { details?: ErrorDetail[]; cause?: unknown; expose?: boolean } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
    this.expose = options.expose ?? statusCode < 500;
  }

  static badRequest(message = 'Bad request', code = 'BAD_REQUEST', details?: ErrorDetail[]) {
    return new ApiError(400, code, message, details ? { details } : {});
  }
  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED') {
    return new ApiError(401, code, message);
  }
  static forbidden(message = 'Forbidden', code = 'FORBIDDEN') {
    return new ApiError(403, code, message);
  }
  static notFound(message = 'Resource not found', code = 'NOT_FOUND') {
    return new ApiError(404, code, message);
  }
  static conflict(message = 'Conflict', code = 'CONFLICT') {
    return new ApiError(409, code, message);
  }
  static validation(details: ErrorDetail[], message = 'Validation failed') {
    return new ApiError(422, 'VALIDATION_ERROR', message, { details });
  }
  static unsupportedMediaType(message = 'Unsupported Content-Type') {
    return new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', message);
  }
  static internal(message = 'Internal server error', cause?: unknown) {
    return new ApiError(500, 'INTERNAL_ERROR', message, { cause, expose: false });
  }
}
