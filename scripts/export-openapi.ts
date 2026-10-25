// Writes the API contract to openapi.json. The frontend repo generates its TypeScript types from
// this file (openapi-typescript), so the two repos share a contract, not code.
// Run: pnpm openapi   (no database needed)
import { writeFileSync } from 'node:fs';

// src/config/env.ts validates on import; the document needs no real database or secrets.
process.env.MONGODB_URI ??= 'mongodb://unused-for-openapi-export';
process.env.LOG_LEVEL = 'silent';

const { openApiDocument } = await import('../src/openapi.ts');
const target = new URL('../openapi.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(openApiDocument, null, 2)}\n`);
console.log(
  `Wrote ${target.pathname} (${String(Object.keys(openApiDocument.paths ?? {}).length)} paths)`,
);
