// Swagger documentation for /auth/* and the account routes under /users/me.
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { errors, jsonContent, security } from '../../lib/openapi.ts';
import {
  changePasswordBody,
  deleteAccountBody,
  forgotPasswordBody,
  loginBody,
  messageResponseSchema,
  registerBody,
  resetPasswordBody,
  sessionIdParams,
  sessionListResponseSchema,
  verifyEmailBody,
} from './auth.schemas.ts';
import { userResponseSchema } from '../users/users.schemas.ts';

const tags = ['Auth'];
const accountTags = ['Account'];

const setCookieHeader = {
  'Set-Cookie': {
    description: '`mc_session` cookie: HttpOnly, SameSite=Lax, Secure in production, 30 days.',
    schema: { type: 'string' as const },
  },
};

export const authPaths: ZodOpenApiPathsObject = {
  '/auth/register': {
    post: {
      tags,
      summary: 'Create an account',
      description:
        "Always returns **202** with the same body, whether or not the email is already registered, so the response can't be used to discover accounts. New accounts get a verification email; existing owners get a notice. Does **not** log in: call `/auth/login` next.",
      security: security.publicWrite,
      requestBody: { content: jsonContent(registerBody) },
      responses: {
        '202': { description: 'Accepted.', content: jsonContent(messageResponseSchema) },
        '400': errors.validation,
        '403': errors.csrf,
        '429': errors.rateLimited,
      },
    },
  },
  '/auth/login': {
    post: {
      tags,
      summary: 'Log in',
      description:
        'Creates a session and sets the `mc_session` cookie. Wrong email and wrong password give the same error. Limited to 5 failed attempts per IP + email and 20 per IP per 15 minutes.',
      security: security.publicWrite,
      requestBody: { content: jsonContent(loginBody) },
      responses: {
        '200': {
          description: 'Logged in.',
          headers: setCookieHeader,
          content: jsonContent(userResponseSchema),
        },
        '400': errors.validation,
        '401': errors.invalidCredentials,
        '403': errors.csrf,
        '429': errors.rateLimited,
      },
    },
  },
  '/auth/logout': {
    post: {
      tags,
      summary: 'Log out of this device',
      description: 'Revokes the current session on the server and clears the cookie.',
      security: security.sessionWrite,
      responses: {
        '204': { description: 'Logged out.' },
        '401': errors.unauthenticated,
        '403': errors.csrf,
      },
    },
  },
  '/auth/logout-all': {
    post: {
      tags,
      summary: 'Log out of every device',
      security: security.sessionWrite,
      responses: {
        '204': { description: 'All sessions revoked.' },
        '401': errors.unauthenticated,
        '403': errors.csrf,
      },
    },
  },
  '/auth/verify-email': {
    post: {
      tags,
      summary: 'Verify email address',
      description: 'Consumes the single-use token from the verification email (valid 24 hours).',
      security: security.publicWrite,
      requestBody: { content: jsonContent(verifyEmailBody) },
      responses: {
        '200': { description: 'Verified.', content: jsonContent(messageResponseSchema) },
        '400': errors.tokenInvalid,
        '403': errors.csrf,
        '429': errors.rateLimited,
      },
    },
  },
  '/auth/verify-email/resend': {
    post: {
      tags,
      summary: 'Resend the verification email',
      description: 'Invalidates earlier links. Does nothing if already verified. 3 per hour.',
      security: security.sessionWrite,
      responses: {
        '202': { description: 'Accepted.', content: jsonContent(messageResponseSchema) },
        '401': errors.unauthenticated,
        '403': errors.csrf,
        '429': errors.rateLimited,
      },
    },
  },
  '/auth/password/forgot': {
    post: {
      tags,
      summary: 'Request a password reset email',
      description:
        'Always returns **202**. If the account exists, a single-use link valid for 30 minutes is emailed and earlier links stop working.',
      security: security.publicWrite,
      requestBody: { content: jsonContent(forgotPasswordBody) },
      responses: {
        '202': { description: 'Accepted.', content: jsonContent(messageResponseSchema) },
        '400': errors.validation,
        '403': errors.csrf,
        '429': errors.rateLimited,
      },
    },
  },
  '/auth/password/reset': {
    post: {
      tags,
      summary: 'Set a new password with a reset token',
      description: 'Consumes the token and **logs out every session** for the account.',
      security: security.publicWrite,
      requestBody: { content: jsonContent(resetPasswordBody) },
      responses: {
        '204': { description: 'Password changed.' },
        '400': errors.tokenInvalid,
        '403': errors.csrf,
        '429': errors.rateLimited,
      },
    },
  },
  '/auth/password/change': {
    post: {
      tags,
      summary: 'Change password (logged in)',
      description: 'Requires the current password. Keeps this session, revokes all others.',
      security: security.sessionWrite,
      requestBody: { content: jsonContent(changePasswordBody) },
      responses: {
        '204': { description: 'Password changed.' },
        '400': errors.validation,
        '401': errors.invalidCredentials,
        '403': errors.csrf,
        '429': errors.rateLimited,
      },
    },
  },
};

export const accountPaths: ZodOpenApiPathsObject = {
  '/users/me/sessions': {
    get: {
      tags: accountTags,
      summary: 'List my active sessions',
      security: security.sessionRead,
      responses: {
        '200': {
          description: 'Sessions, most recent first.',
          content: jsonContent(sessionListResponseSchema),
        },
        '401': errors.unauthenticated,
      },
    },
  },
  '/users/me/sessions/{sessionId}': {
    delete: {
      tags: accountTags,
      summary: 'Revoke one of my sessions',
      description: "Another user's session id returns 404, exactly like an id that doesn't exist.",
      security: security.sessionWrite,
      requestParams: { path: sessionIdParams },
      responses: {
        '204': { description: 'Revoked.' },
        '400': errors.validation,
        '401': errors.unauthenticated,
        '403': errors.csrf,
        '404': errors.notFound,
      },
    },
  },
  '/users/me': {
    delete: {
      tags: accountTags,
      summary: 'Delete my account',
      description:
        'Requires the password. Permanently deletes the account and all its data, and logs out everywhere.',
      security: security.sessionWrite,
      requestBody: { content: jsonContent(deleteAccountBody) },
      responses: {
        '204': { description: 'Account deleted.' },
        '400': errors.validation,
        '401': errors.invalidCredentials,
        '403': errors.csrf,
        '429': errors.rateLimited,
      },
    },
  },
};
