// Stage A extraction (email-capture.md §2.2): fixed rules for known confirmation emails. Pure
// functions, no database: free, deterministic and unit-testable. Anything no rule recognises
// returns null and is left for the LLM stage.
import { escapeRegex } from '../../lib/validation.ts';
import type { Source, WORK_MODES } from '../applications/applications.constants.ts';

export interface EmailForRules {
  direction: 'received' | 'sent';
  from: string;
  subject: string;
  // The plain-text part, and the HTML part converted to text (empty if the email had none).
  text: string;
  htmlText: string;
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
//   HTML:    "{company} - {location}" and "The following items were sent to {company}. Good luck!"
//   The plain-text part only says "Your application has been submitted. Good luck!", so the
//   company and location come from the HTML part.
const indeedApply: Rule = (email) => {
  if (email.direction !== 'received' || senderAddress(email.from) !== 'indeedapply@indeed.com') {
    return null;
  }
  const body = `${email.text}\n\n${email.htmlText}`;
  const title = /^Indeed Application:\s*(.+)$/i.exec(email.subject.trim())?.[1];
  const company = /The following items were sent to\s+([\s\S]+?)\.\s+Good luck!/i.exec(body)?.[1];
  if (!title || !company) return null;

  const companyName = clean(company);
  // `Acme - Lahore`, `Acme <https://…> - Lahore`, or the dash on the next line.
  const location = new RegExp(
    `^[ \\t]*${escapeRegex(companyName)}[ \\t]*(?:<[^>\\n]*>)?[ \\t]*\\n?[ \\t]*-[ \\t]*(.+)$`,
    'im',
  ).exec(body)?.[1];

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

const HEADING = /your application was sent to/i;
const NOT_A_PLACE = /^(view job|applied on)\b/i;

// Reads one LinkedIn body. Two layouts are known:
//   plain-text part:  "{title}" / "{company}" / "{location}" / "View job: https://…"
//   HTML part:        "{title}" / "{company} · {location} ({On-site|Remote|Hybrid})"
// Everything from the "similar jobs" list on is cut off first, so it can never be picked.
function parseLinkedinBody(
  body: string,
  companyName: string,
): Pick<CapturedApplication, 'title' | 'location' | 'workMode' | 'jobUrl'> | null {
  const ownPart = body.split(/similar jobs|next steps for more success/i)[0] ?? '';
  const lines = textLines(ownPart).filter((line) => line !== '' && !/^-+$/.test(line));
  const companyRe = new RegExp(`^${escapeRegex(companyName)}\\s*(?:·\\s*(.+))?$`, 'i');
  const at = lines.findIndex((line, i) => i > 0 && companyRe.test(line));
  const title = lines[at - 1];
  if (at < 1 || !title || HEADING.test(title)) return null;

  const next = lines[at + 1];
  const place =
    companyRe.exec(lines[at] ?? '')?.[1] ?? (next && !NOT_A_PLACE.test(next) ? next : null);
  const parts = place ? /^(.+?)\s*(?:\(([^)]+)\))?$/.exec(place) : null;
  const jobId = /linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/i.exec(ownPart)?.[1];

  return {
    title: title.slice(0, 200),
    location: parts?.[1] ? parts[1].slice(0, 200) : null,
    workMode: WORK_MODE_LABELS[parts?.[2]?.toLowerCase() ?? ''] ?? null,
    jobUrl: jobId ? `https://www.linkedin.com/jobs/view/${jobId}/` : null,
  };
}

// LinkedIn confirmation:
//   From:    LinkedIn <jobs-noreply@linkedin.com>
//   Subject: {name}, your application was sent to {company}
//   Body:    see parseLinkedinBody. The plain-text part is tried first, then the HTML part.
const linkedinApplied: Rule = (email) => {
  if (email.direction !== 'received' || senderAddress(email.from) !== 'jobs-noreply@linkedin.com') {
    return null;
  }
  const company = /your application was sent to\s+(.+)$/i.exec(email.subject.trim())?.[1];
  if (!company) return null;
  const companyName = clean(company);

  const job =
    parseLinkedinBody(email.text, companyName) ?? parseLinkedinBody(email.htmlText, companyName);
  if (!job) return null;

  return {
    kind: 'application_confirmation',
    source: 'linkedin',
    company: companyName,
    ...job,
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
