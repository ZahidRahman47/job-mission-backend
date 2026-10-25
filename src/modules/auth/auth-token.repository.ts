// Create, consume (atomically, once) and invalidate auth tokens.
import { AuthTokenModel, type AuthTokenRecord, type AuthTokenType } from './auth-token.model.ts';

export async function create(input: {
  userId: string;
  type: AuthTokenType;
  tokenHash: string;
  expiresAt: Date;
}): Promise<void> {
  await AuthTokenModel.create(input);
}

// One atomic find-and-mark. Two simultaneous clicks on the same link can't both succeed,
// because only one update can change usedAt from null.
export function consume(type: AuthTokenType, tokenHash: string): Promise<AuthTokenRecord | null> {
  const now = new Date();
  return AuthTokenModel.findOneAndUpdate(
    { type, tokenHash, usedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
    { returnDocument: 'after' },
  )
    .lean<AuthTokenRecord>()
    .exec();
}

export async function deleteForUser(userId: string, type?: AuthTokenType): Promise<void> {
  await AuthTokenModel.deleteMany({ userId, ...(type !== undefined && { type }) }).exec();
}
