// Fixed value sets for applications. Fixed lists (not free text) keep filters and analytics meaningful.

export const APPLICATION_STATUSES = [
  'saved',
  'applied',
  'screening',
  'interview',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

// Still in play: counted as "active pipeline" on the dashboard.
export const ACTIVE_STATUSES = ['applied', 'screening', 'interview', 'offer'] as const;
export const TERMINAL_STATUSES = ['accepted', 'rejected', 'withdrawn'] as const;

export const SOURCES = [
  'linkedin',
  'company_site',
  'referral',
  'job_board',
  'recruiter_outreach',
  'networking',
  'other',
] as const;
export type Source = (typeof SOURCES)[number];

export const PRIORITIES = ['low', 'medium', 'high'] as const;
export const WORK_MODES = ['remote', 'hybrid', 'onsite'] as const;
export const EMPLOYMENT_TYPES = [
  'full_time',
  'part_time',
  'contract',
  'internship',
  'temporary',
] as const;
export const SALARY_PERIODS = ['year', 'month', 'hour'] as const;

export const INTERVIEW_TYPES = [
  'phone_screen',
  'technical',
  'behavioral',
  'system_design',
  'take_home',
  'onsite',
  'final',
  'other',
] as const;
export const INTERVIEW_OUTCOMES = ['pending', 'passed', 'failed', 'cancelled'] as const;

export const MAX_INTERVIEWS = 20;
export const MAX_CONTACTS_PER_APPLICATION = 10;
