// Validates process.env with Zod at startup and exports a typed `env`.
// Exits with a clear message if anything is missing or invalid (NFR-019).
import { z } from 'zod';

// An origin is scheme + host (+ port) only: browsers send `Origin: https://app.example.com`, no path.
const origin = z
  .string()
  .regex(
    /^https?:\/\/[^/\s]+$/,
    'must be an origin like https://app.example.com (no path or trailing slash)',
  );

// 1. Define the environment variable schema
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Env values are always strings, so coerce "4000" -> 4000. 4000 avoids Next.js's default 3000.
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  // `silent` is for the test suite.
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Required, no default: the app cannot do anything useful without a database.
  MONGODB_URI: z
    .string()
    .regex(/^mongodb(\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://'),

  // Frontend origins allowed to call the API with cookies (CORS + CSRF), comma-separated.
  WEB_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    )
    .pipe(z.array(origin).min(1)),

  // Base URL of the web app, used to build links in emails (verify email, reset password).
  APP_URL: z.url().default('http://localhost:3000'),

  // Set in production to share the session cookie across subdomains, e.g. `.missioncontrol.app`.
  COOKIE_DOMAIN: z.string().min(1).optional(),

  // Number of reverse proxies in front of the API. Decides which IP rate limits see (threat T15).
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

  // MongoDB connections each running instance may hold. Serverless (Vercel sets VERCEL=1) runs
  // many small instances at once, so each keeps few: a traffic spike must not exhaust the Atlas
  // free tier's connection limit (~500). A long-lived server shares one bigger pool.
  MONGODB_MAX_POOL_SIZE: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(process.env.VERCEL ? 3 : 10),
});

// 2. Validate process.env at startup
const result = envSchema.safeParse(process.env);

// 3. Stop startup if validation fails. Print names and reasons only, never values:
//    MONGODB_URI contains the database password.
if (!result.success) {
  console.error('❌ Invalid environment variables:');

  for (const issue of result.error.issues) {
    console.error(`- ${issue.path.join('.')}: ${issue.message}`);
  }

  process.exit(1);
}

// 4. Export the validated, typed environment
export const env = result.data;
