// AppError and subclasses. Code throws these; the error handler turns them into the standard
// `{ error: { code, message, details, requestId } }` response (architecture.md 6.1).

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ValidationIssue {
  location: 'body' | 'query' | 'params';
  path: string[];
  message: string;
}

export class ValidationError extends AppError {
  constructor(issues: ValidationIssue[]) {
    super(400, 'VALIDATION_ERROR', 'The request contains invalid fields.', issues);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(code: 'UNAUTHENTICATED' | 'SESSION_EXPIRED' = 'UNAUTHENTICATED') {
    super(
      401,
      code,
      code === 'SESSION_EXPIRED'
        ? 'Your session has expired. Please log in again.'
        : 'Authentication required.',
    );
  }
}

// One message for "no such email" and "wrong password", so responses can't reveal which accounts exist.
export class InvalidCredentialsError extends AppError {
  constructor() {
    super(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }
}

export class TokenInvalidError extends AppError {
  constructor() {
    super(400, 'TOKEN_INVALID', 'This link is invalid or has expired.');
  }
}

export class ForbiddenError extends AppError {
  constructor(code: string, message: string) {
    super(403, code, message);
  }
}

// Also used for "exists but belongs to another user", so IDs can't be probed (NFR-009).
export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, 'NOT_FOUND', `${resource} not found.`, { resource });
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super(409, code, message, details);
  }
}

export class RateLimitedError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(429, 'RATE_LIMITED', 'Too many requests. Please try again later.', { retryAfterSeconds });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// MongoDB unique-index violation (E11000), e.g. two registrations racing for the same email.
export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 11000;
}
