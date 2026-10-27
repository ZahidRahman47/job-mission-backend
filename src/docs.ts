// API docs (OpenAPI JSON + Swagger UI), development only. Kept out of app.ts's imports and loaded
// on first use: building the OpenAPI document is the slowest part of startup, and production
// never serves it, so serverless cold starts there skip it entirely.
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './openapi.ts';

export { openApiDocument };

export const docsRouter = Router();
docsRouter.use(swaggerUi.serve, swaggerUi.setup(openApiDocument));
