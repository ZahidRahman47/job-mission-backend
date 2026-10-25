// Pure functions: allowed transitions, the reopen rule, and which milestones a status sets
// (requirements.md 3.1, BR-001 to BR-007). No database access, so every rule is unit-testable.
import { TERMINAL_STATUSES, type ApplicationStatus } from './applications.constants.ts';

const TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  saved: ['applied', 'withdrawn'],
  applied: ['screening', 'interview', 'offer', 'rejected', 'withdrawn'],
  screening: ['interview', 'offer', 'rejected', 'withdrawn'],
  interview: ['offer', 'rejected', 'withdrawn'],
  offer: ['accepted', 'rejected', 'withdrawn'],
  accepted: [],
  rejected: [],
  withdrawn: [],
};

const REOPENABLE: readonly ApplicationStatus[] = ['rejected', 'withdrawn'];

export function isTerminal(status: ApplicationStatus): boolean {
  return (TERMINAL_STATUSES as readonly ApplicationStatus[]).includes(status);
}

// BR-003: rejected/withdrawn may go back to the status held just before (mis-click, "they came back").
export function isReopen(
  from: ApplicationStatus,
  to: ApplicationStatus,
  previousStatus: ApplicationStatus | null,
): boolean {
  return REOPENABLE.includes(from) && previousStatus !== null && to === previousStatus;
}

export function allowedTransitions(
  from: ApplicationStatus,
  previousStatus: ApplicationStatus | null,
): ApplicationStatus[] {
  const allowed = [...TRANSITIONS[from]];
  if (REOPENABLE.includes(from) && previousStatus !== null && previousStatus !== from) {
    allowed.push(previousStatus);
  }
  return allowed;
}

export interface Milestones {
  respondedAt: Date | null;
  screeningAt: Date | null;
  interviewAt: Date | null;
  offerAt: Date | null;
  closedAt: Date | null;
}

export const EMPTY_MILESTONES: Milestones = {
  respondedAt: null,
  screeningAt: null,
  interviewAt: null,
  offerAt: null,
  closedAt: null,
};

// Statuses that prove the employer responded (BR-006). Withdrawn is the user's action, not a response.
const RESPONSE_STATUSES: readonly ApplicationStatus[] = [
  'screening',
  'interview',
  'offer',
  'rejected',
];

// Milestones newly reached by moving into `to`. Set-once (BR-005): never overwrites an existing one.
export function milestonesReached(
  to: ApplicationStatus,
  at: Date,
  current: Milestones,
): Partial<Milestones> {
  const reached: Partial<Milestones> = {};
  if (RESPONSE_STATUSES.includes(to) && current.respondedAt === null) reached.respondedAt = at;
  if (to === 'screening' && current.screeningAt === null) reached.screeningAt = at;
  if (to === 'interview' && current.interviewAt === null) reached.interviewAt = at;
  if (to === 'offer' && current.offerAt === null) reached.offerAt = at;
  if (isTerminal(to) && current.closedAt === null) reached.closedAt = at;
  return reached;
}

// BR-007: an application created directly in a later status (e.g. imported at "offer") gets every
// milestone that status implies, dated at `at` (its applied date).
const IMPLIED_PATH: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  saved: [],
  applied: [],
  screening: ['screening'],
  interview: ['interview'],
  offer: ['interview', 'offer'],
  accepted: ['interview', 'offer', 'accepted'],
  rejected: ['rejected'],
  withdrawn: ['withdrawn'],
};

export function initialMilestones(status: ApplicationStatus, at: Date): Milestones {
  let milestones = { ...EMPTY_MILESTONES };
  for (const step of IMPLIED_PATH[status]) {
    milestones = { ...milestones, ...milestonesReached(step, at, milestones) };
  }
  return milestones;
}
