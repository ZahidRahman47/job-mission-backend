// Mailer used for verification, password-reset and security emails.
// For now every environment logs instead of sending; the Resend transport is added in Phase 7.
// Tests replace `mailer.send` with a spy to read the links that would have been emailed.
import { env } from '../config/env.ts';
import { logger } from './logger.ts';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export const mailer = {
  send(message: MailMessage): Promise<void> {
    if (env.NODE_ENV === 'production') {
      // Never write email bodies to production logs: they contain single-use tokens.
      logger.warn({ subject: message.subject }, 'No email transport configured; email not sent');
    } else {
      logger.info(
        { to: message.to, subject: message.subject },
        `📧 ${message.subject}\n${message.text}`,
      );
    }
    return Promise.resolve();
  },
};
