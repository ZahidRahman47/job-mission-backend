// Runs before each test file: points the app at a fresh database of its own, creates indexes,
// and empties every collection before each test so tests can't affect each other.
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, inject, vi } from 'vitest';

// Must happen before any app module loads, because src/config/env.ts validates on import.
process.env.MONGODB_URI = inject('mongoUri');

// Loading the app registers every Mongoose model, so syncIndexes() knows what to create.
await import('../../src/app.ts');
const { syncIndexes } = await import('../../src/db/connect.ts');

beforeAll(async () => {
  await mongoose.connect(inject('mongoUri'), { dbName: `test_${randomUUID()}` });
  await syncIndexes();
});

beforeEach(async () => {
  vi.clearAllMocks();
  const db = mongoose.connection.db;
  if (!db) throw new Error('Test database is not connected');
  for (const collection of await db.collections()) {
    await collection.deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
