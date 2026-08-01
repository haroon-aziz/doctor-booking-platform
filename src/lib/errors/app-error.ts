/**
 * A single error taxonomy shared by server actions, route handlers and
 * services. Every thrown `AppError` carries an HTTP status and a stable
 * machine-readable `code`, so the transport layer never has to guess how to
 * render a failure and clients can branch on `code` rather than on prose.
 */

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "SLOT_UNAVAILABLE"
  | "SLOT_HOLD_EXPIRED"
  | "BOOKING_WINDOW_INVALID"
  | "PAYMENT_FAILED"
  | "RATE_LIMITED"
  | "UPLOAD_REJECTED"
  | "DEPENDENCY_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface AppErrorOptions {
  code: ErrorCode;
  message: string;
  status: number;
  /** Field-level messages, keyed by form field path. */
  fieldErrors?: Record<string, string[]>;
  /** Non-sensitive context attached to logs; never returned to the client. */
  context?: Record<string, unknown>;
  cause?: unknown;
  /** Seconds the caller should wait before retrying. */
  retryAfter?: number;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors?: Record<string, string[]>;
  readonly context?: Record<string, unknown>;
  readonly retryAfter?: number;
  readonly isOperational = true;

  constructor(options: AppErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "AppError";
    this.code = options.code;
    this.status = options.status;
    this.fieldErrors = options.fieldErrors;
    this.context = options.context;
    this.retryAfter = options.retryAfter;
    Error.captureStackTrace?.(this, AppError);
  }

  /** The shape sent over the wire — deliberately free of internal context. */
  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.fieldErrors ? { fieldErrors: this.fieldErrors } : {}),
        ...(this.retryAfter ? { retryAfter: this.retryAfter } : {}),
      },
    };
  }
}

export class ValidationError extends AppError {
  constructor(message = "The submitted data is invalid.", fieldErrors?: Record<string, string[]>) {
    super({ code: "VALIDATION_ERROR", message, status: 422, fieldErrors });
    this.name = "ValidationError";
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "You must be signed in to do this.") {
    super({ code: "UNAUTHENTICATED", message, status: 401 });
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do this.", context?: Record<string, unknown>) {
    super({ code: "FORBIDDEN", message, status: 403, context });
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super({ code: "NOT_FOUND", message: `${resource} was not found.`, status: 404 });
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super({ code: "CONFLICT", message, status: 409, context });
    this.name = "ConflictError";
  }
}

export class SlotUnavailableError extends AppError {
  constructor(message = "That time slot is no longer available.") {
    super({ code: "SLOT_UNAVAILABLE", message, status: 409 });
    this.name = "SlotUnavailableError";
  }
}

export class SlotHoldExpiredError extends AppError {
  constructor(message = "Your reservation expired. Please pick a time again.") {
    super({ code: "SLOT_HOLD_EXPIRED", message, status: 410 });
    this.name = "SlotHoldExpiredError";
  }
}

export class BookingWindowError extends AppError {
  constructor(message: string) {
    super({ code: "BOOKING_WINDOW_INVALID", message, status: 422 });
    this.name = "BookingWindowError";
  }
}

export class PaymentFailedError extends AppError {
  constructor(message = "The payment could not be processed.", context?: Record<string, unknown>) {
    super({ code: "PAYMENT_FAILED", message, status: 402, context });
    this.name = "PaymentFailedError";
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfter: number, message = "Too many requests. Please slow down.") {
    super({ code: "RATE_LIMITED", message, status: 429, retryAfter });
    this.name = "RateLimitedError";
  }
}

export class UploadRejectedError extends AppError {
  constructor(message: string) {
    super({ code: "UPLOAD_REJECTED", message, status: 415 });
    this.name = "UploadRejectedError";
  }
}

export class DependencyUnavailableError extends AppError {
  constructor(dependency: string, cause?: unknown) {
    super({
      code: "DEPENDENCY_UNAVAILABLE",
      message: `${dependency} is currently unavailable. Please try again shortly.`,
      status: 503,
      context: { dependency },
      cause,
    });
    this.name = "DependencyUnavailableError";
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Normalises anything thrown into an AppError. Unknown throwables become a
 * generic 500 so an internal message (a SQL string, a stack trace) can never
 * reach the client by accident.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;

  return new AppError({
    code: "INTERNAL_ERROR",
    message: "Something went wrong on our end. Please try again.",
    status: 500,
    cause: error,
  });
}
