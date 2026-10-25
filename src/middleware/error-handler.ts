// The single place that turns any thrown error into an HTTP error response. Never leaks stack
// traces, database messages or internal paths to clients (NFR-017, architecture.md 6.2).
import type { ErrorRequestHandler } from 'express';
import mongoose from 'mongoose';
import {
  AppError,
  ConflictError,
  isDuplicateKeyError,
  RateLimitedError,
  ValidationError,
} from '../lib/errors.ts';

const DATABASE_UNAVAILABLE_ERRORS = new Set([
  'MongoServerSelectionError',
  'MongooseServerSelectionError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
]);

// Errors thrown by express.json() carry a `type` such as 'entity.too.large'.
function isBodyParserError(err: unknown): err is { type: string } {
  return typeof err === 'object' && err !== null && 'type' in err && typeof err.type === 'string';
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (isBodyParserError(err)) {
    if (err.type === 'entity.too.large') {
      return new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');
    }
    return new AppError(400, 'MALFORMED_REQUEST', 'The request body could not be parsed.');
  }

  if (err instanceof mongoose.Error.CastError) {
    return new ValidationError([{ location: 'params', path: [err.path], message: 'Invalid id.' }]);
  }

  if (isDuplicateKeyError(err)) {
    return new ConflictError('ALREADY_EXISTS', 'This resource already exists.');
  }

  if (err instanceof Error && DATABASE_UNAVAILABLE_ERRORS.has(err.name)) {
    return new AppError(503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable.');
  }

  return new AppError(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  // If streaming a response already started, Express must close the connection itself.
  if (res.headersSent) {
    next(err);
    return;
  }

  const appError = toAppError(err);

  // Expected errors (4xx) are the client's problem; unexpected ones (5xx) need the full stack.
  if (appError.status >= 500) req.log.error({ err }, 'Request failed');
  if (appError instanceof RateLimitedError) {
    res.setHeader('Retry-After', String(appError.retryAfterSeconds));
  }

  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined && { details: appError.details }),
      // Always a string: the requestId middleware sets it. pino-http types it more loosely.
      requestId: typeof req.id === 'string' ? req.id : '',
    },
  });
};
