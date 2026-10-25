// Argon2id hash/verify, plus dummy-hash timing equalization for unknown emails (NFR-007, FR-006).
import * as argon2 from 'argon2';

// OWASP minimum for Argon2id: 19 MiB memory, 2 iterations, 1 lane. Memory-hard, so GPU cracking
// of a leaked hash is expensive.
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, HASH_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // A malformed stored hash must fail closed, never throw a 500 that hints at the account.
    return false;
  }
}

// True when a hash was made with older/weaker parameters, so we upgrade it at the next login.
export function needsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, HASH_OPTIONS);
}

let dummyHash: Promise<string> | undefined;

// Login for an unknown email still spends the time of one real verification. Otherwise
// "fast failure = no such account" would leak which emails are registered.
export async function verifyAgainstDummyHash(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-used-only-for-timing');
  await verifyPassword(await dummyHash, password);
}
