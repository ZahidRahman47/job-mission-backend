// Unknown routes -> 404 ROUTE_NOT_FOUND in the standard error envelope.
import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.ts';

export const notFound: RequestHandler = (req) => {
  throw new AppError(404, 'ROUTE_NOT_FOUND', `Route ${req.method} ${req.path} not found.`);
};
