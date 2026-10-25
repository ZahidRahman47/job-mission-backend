// Mongoose schema for applications with embedded interviews, milestones and indexes A1-A6
// (implementation-plan.md 3.6). Interviews are embedded: bounded (max 20) and always read together.
import { model, Schema, type Types } from 'mongoose';
import {
  APPLICATION_STATUSES,
  EMPLOYMENT_TYPES,
  INTERVIEW_OUTCOMES,
  INTERVIEW_TYPES,
  PRIORITIES,
  SALARY_PERIODS,
  SOURCES,
  WORK_MODES,
  type ApplicationStatus,
  type Source,
} from './applications.constants.ts';
import type { Milestones } from './status-machine.ts';

const interviewSchema = new Schema({
  round: { type: Number, required: true, min: 1, max: 50 },
  type: { type: String, enum: INTERVIEW_TYPES, required: true },
  scheduledAt: { type: Date, default: null },
  durationMinutes: { type: Number, min: 5, max: 600, default: null },
  interviewers: { type: [String], default: [] },
  outcome: { type: String, enum: INTERVIEW_OUTCOMES, default: 'pending' },
  notes: { type: String, maxlength: 5000, default: '' },
});

const salarySchema = new Schema(
  {
    min: { type: Number, min: 0, default: null },
    max: { type: Number, min: 0, default: null },
    currency: { type: String, required: true },
    period: { type: String, enum: SALARY_PERIODS, required: true },
  },
  { _id: false },
);

// Set the first time each stage is reached and never cleared (BR-005). Analytics read these
// instead of replaying the activity history.
const milestonesSchema = new Schema(
  {
    respondedAt: { type: Date, default: null },
    screeningAt: { type: Date, default: null },
    interviewAt: { type: Date, default: null },
    offerAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
  },
  { _id: false },
);

const applicationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    companyId: { type: Schema.Types.ObjectId, required: true },
    // Copy of the company's name so lists can search/sort without a join (ADR-007).
    companyName: { type: String, required: true, maxlength: 200 },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    jobDescription: { type: String, maxlength: 20_000, default: null },
    location: { type: String, maxlength: 200, default: null },
    workMode: { type: String, enum: WORK_MODES, default: null },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: null },
    salary: { type: salarySchema, default: null },
    jobUrl: { type: String, maxlength: 2000, default: null },
    source: { type: String, enum: SOURCES, required: true, default: 'other' },
    priority: { type: String, enum: PRIORITIES, required: true, default: 'medium' },
    status: { type: String, enum: APPLICATION_STATUSES, required: true },
    previousStatus: { type: String, enum: APPLICATION_STATUSES, default: null },
    appliedAt: { type: Date, default: null },
    milestones: { type: milestonesSchema, default: () => ({}) },
    // Earliest pending reminder; maintained by the reminders module, never set by clients (BR-012).
    nextFollowUpAt: { type: Date, default: null },
    contactIds: { type: [Schema.Types.ObjectId], default: [] },
    interviews: { type: [interviewSchema], default: [] },
    archivedAt: { type: Date, default: null },
    // Reserved for v2 job import (ADR-011).
    external: {
      type: new Schema({ provider: String, id: String, url: String }, { _id: false }),
      default: null,
    },
    // Optimistic concurrency: every user edit must send the version it read (FR-025).
    version: { type: Number, required: true, default: 0 },
  },
  { timestamps: true, strict: 'throw' },
);

applicationSchema.index({ userId: 1, archivedAt: 1, appliedAt: -1, _id: -1 }); // A1 default list
applicationSchema.index({ userId: 1, archivedAt: 1, status: 1, appliedAt: -1, _id: -1 }); // A2 by status
applicationSchema.index({ userId: 1, nextFollowUpAt: 1 }); // A3 sort by follow-up
applicationSchema.index({ userId: 1, appliedAt: 1 }); // A4 analytics cohort
applicationSchema.index({ userId: 1, 'interviews.scheduledAt': 1 }); // A5 upcoming interviews
applicationSchema.index({ userId: 1, companyId: 1 }); // A6 company page, in-use check, rename

export interface InterviewRecord {
  _id: Types.ObjectId;
  round: number;
  type: (typeof INTERVIEW_TYPES)[number];
  scheduledAt: Date | null;
  durationMinutes: number | null;
  interviewers: string[];
  outcome: (typeof INTERVIEW_OUTCOMES)[number];
  notes: string;
}

export interface SalaryRecord {
  min: number | null;
  max: number | null;
  currency: string;
  period: (typeof SALARY_PERIODS)[number];
}

// Explicit lean shape: clearer than Mongoose's inferred type for nested arrays and subdocuments.
export interface ApplicationRecord {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  companyId: Types.ObjectId;
  companyName: string;
  title: string;
  jobDescription: string | null;
  location: string | null;
  workMode: (typeof WORK_MODES)[number] | null;
  employmentType: (typeof EMPLOYMENT_TYPES)[number] | null;
  salary: SalaryRecord | null;
  jobUrl: string | null;
  source: Source;
  priority: (typeof PRIORITIES)[number];
  status: ApplicationStatus;
  previousStatus: ApplicationStatus | null;
  appliedAt: Date | null;
  milestones: Milestones;
  nextFollowUpAt: Date | null;
  contactIds: Types.ObjectId[];
  interviews: InterviewRecord[];
  archivedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export const ApplicationModel = model('Application', applicationSchema);
