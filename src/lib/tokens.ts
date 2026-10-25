// Random 256-bit tokens and their SHA-256 hashes (sessions, email verification, password reset).
// The raw token goes to the user (cookie or email link); only the hash is stored, so a database
// leak exposes no usable tokens (NFR-008).
import { createHash, randomBytes } from 'node:crypto';

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

// SHA-256 (not Argon2) is right here: the token is already 256 bits of randomness, so there is
// nothing to brute-force, and we need a fast, deterministic lookup key.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
