// Gives every request an ID (from X-Request-Id or generated) and echoes it in the response header,
// so one ID ties together the client error, the log lines and the error body (NFR-021).
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

// Accept a caller's ID only if it's short and harmless; otherwise it could pollute our logs.
const VALID_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  const id = incoming !== undefined && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();

  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
};
