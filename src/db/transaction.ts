// Runs a function inside a MongoDB transaction: all writes commit together or none do.
// Mongoose's AsyncLocalStorage support (enabled in connect.ts) attaches the session to every query
// inside `fn` automatically, so repositories don't need a `session` parameter. Mongoose also
// retries `fn` on transient errors such as write conflicts.
// Only top-level service operations start a transaction; never nest them.
import mongoose from 'mongoose';

export function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  return mongoose.connection.transaction(fn);
}
