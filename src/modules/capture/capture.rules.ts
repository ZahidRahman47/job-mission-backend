// Stage A extraction (email-capture.md §2.2): fixed rules for known confirmation emails. Pure
// functions, no database: free, deterministic and unit-testable. Anything no rule recognises
// returns null and is left for the LLM stage.
import { escapeRegex } from '../../lib/validation.ts';
import type { Source, WORK_MODES } from '../applications/applications.constants.ts';

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
  workMode: WorkMode | null;
  jobUrl: string | null;
  appliedAt: Date;
}

type WorkMode = (typeof WORK_MODES)[number];

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
    workMode: null,
    jobUrl: null,
    appliedAt: email.sentAt,
  };
};

// Text lines with links removed: `Senior Engineer <https://…>` and bare URLs -> `Senior Engineer`.
function textLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => clean(line.replace(/<https?:[^>]*>/g, '').replace(/https?:\/\/\S+/g, '')));
}

const WORK_MODE_LABELS: Record<string, WorkMode> = {
  'on-site': 'onsite',
  onsite: 'onsite',
  remote: 'remote',
  hybrid: 'hybrid',
};

// LinkedIn confirmation:
//   From:    LinkedIn <jobs-noreply@linkedin.com>
//   Subject: {name}, your application was sent to {company}
//   Body:    "{title}" then "{company} · {location} ({On-site|Remote|Hybrid})", then a
//            "similar jobs" list that must be ignored: only the text before it is read.
const linkedinApplied: Rule = (email) => {
  if (email.direction !== 'received' || senderAddress(email.from) !== 'jobs-noreply@linkedin.com') {
    return null;
  }
  const company = /your application was sent to\s+(.+)$/i.exec(email.subject.trim())?.[1];
  if (!company) return null;
  const companyName = clean(company);

  const ownPart = email.text.split(/similar jobs|next steps for more success/i)[0] ?? '';
  const lines = textLines(ownPart);
  const companyLine = lines.findIndex((line) =>
    new RegExp(`^${escapeRegex(companyName)}\\s*·`, 'i').test(line),
  );
  if (companyLine < 1) return null;

  // The title is the nearest text line above "{company} · …", skipping the heading itself.
  const title = lines
    .slice(0, companyLine)
    .reverse()
    .find((line) => line !== '' && !/your application was sent to/i.test(line));
  if (!title) return null;

  const place = /·\s*(.+?)\s*(?:\(([^)]+)\))?$/.exec(lines[companyLine] ?? '');
  const jobId = /linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/i.exec(ownPart)?.[1];

  return {
    kind: 'application_confirmation',
    source: 'linkedin',
    company: companyName,
    title: title.slice(0, 200),
    location: place?.[1] ? place[1].slice(0, 200) : null,
    workMode: WORK_MODE_LABELS[place?.[2]?.toLowerCase() ?? ''] ?? null,
    jobUrl: jobId ? `https://www.linkedin.com/jobs/view/${jobId}/` : null,
    appliedAt: email.sentAt,
  };
};

const RULES: readonly Rule[] = [indeedApply, linkedinApplied];

export function extractByRules(email: EmailForRules): CapturedApplication | null {
  for (const rule of RULES) {
    const result = rule(email);
    if (result) return result;
  }
  return null;
}
