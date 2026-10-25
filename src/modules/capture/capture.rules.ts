// Stage A extraction (email-capture.md §2.2): fixed rules for known confirmation emails. Pure
// functions, no database: free, deterministic and unit-testable. Anything no rule recognises
// returns null and is left for the LLM stage.
import { escapeRegex } from '../../lib/validation.ts';
import type { Source } from '../applications/applications.constants.ts';

export interface EmailForRules {
  direction: 'received' | 'sent';
  from: string;
  subject: string;
  text: string;
  sentAt: Date;
}

export interface CapturedApplication {
  kind: 'application_confirmation';
  source: Source;
  company: string;
  title: string;
  location: string | null;
  appliedAt: Date;
}

type Rule = (email: EmailForRules) => CapturedApplication | null;

// `"Indeed Apply" <IndeedApply@indeed.com>` -> `indeedapply@indeed.com`
export function senderAddress(from: string): string {
  const bracketed = /<([^<>\s]+@[^<>\s]+)>/.exec(from);
  return (bracketed?.[1] ?? from).trim().toLowerCase();
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

// Indeed Apply confirmation:
//   From:    Indeed Apply <indeedapply@indeed.com>
//   Subject: Indeed Application: {title}
//   Body:    "{company} - {location}" and "The following items were sent to {company}. Good luck!"
const indeedApply: Rule = (email) => {
  if (email.direction !== 'received' || senderAddress(email.from) !== 'indeedapply@indeed.com') {
    return null;
  }
  const title = /^Indeed Application:\s*(.+)$/i.exec(email.subject.trim())?.[1];
  const company = /The following items were sent to\s+([\s\S]+?)\.\s+Good luck!/i.exec(
    email.text,
  )?.[1];
  if (!title || !company) return null;

  const companyName = clean(company);
  // Plain-text bodies may keep the link after the company name: `Acme <https://…> - Lahore`.
  const location = new RegExp(
    `^\\s*${escapeRegex(companyName)}\\s*(?:<[^>]*>)?\\s*-\\s*(.+)$`,
    'im',
  ).exec(email.text)?.[1];

  return {
    kind: 'application_confirmation',
    source: 'indeed',
    company: companyName,
    title: clean(title),
    location: location ? clean(location).slice(0, 200) : null,
    appliedAt: email.sentAt,
  };
};

const RULES: readonly Rule[] = [indeedApply];

export function extractByRules(email: EmailForRules): CapturedApplication | null {
  for (const rule of RULES) {
    const result = rule(email);
    if (result) return result;
  }
  return null;
}
