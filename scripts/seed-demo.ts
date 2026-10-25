// Seeds a demo account with ~150 realistic applications over the last 90 days, so the UI has
// something to show. Safe to re-run: the previous demo account and all its data are deleted first.
// Run: pnpm seed:demo   (uses MONGODB_URI from .env; never point this at production)
import { Types } from 'mongoose';
import { connectToDatabase, disconnectFromDatabase } from '../src/db/connect.ts';
import type { ApplicationStatus } from '../src/modules/applications/applications.constants.ts';
import { ApplicationModel } from '../src/modules/applications/applications.model.ts';
import {
  initialMilestones,
  milestonesReached,
} from '../src/modules/applications/status-machine.ts';
import { ActivityModel } from '../src/modules/activities/activities.model.ts';
import { resumePendingDeletions } from '../src/modules/auth/auth.service.ts';
import { hashPassword } from '../src/modules/auth/password.ts';
import { CompanyModel } from '../src/modules/companies/companies.model.ts';
import { ContactModel } from '../src/modules/contacts/contacts.model.ts';
import { ReminderModel } from '../src/modules/reminders/reminders.model.ts';
import { UserModel } from '../src/modules/users/users.model.ts';
import * as usersService from '../src/modules/users/users.service.ts';
import { env } from '../src/config/env.ts';

export const DEMO_EMAIL = 'demo@missioncontrol.dev';
export const DEMO_PASSWORD = 'demo-password-123';

if (env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production.');

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.now();

let seed = 20261025;
const rand = (): number => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(list: readonly [T, ...T[]]): T =>
  list[Math.floor(rand() * list.length)] ?? list[0];
const between = (min: number, max: number): number => min + rand() * (max - min);

const COMPANIES = [
  'Halcyon Pay',
  'Northwind Labs',
  'Orbital Freight',
  'Ledgerline',
  'Quanta Health',
  'Brightwell',
  'Tessellate AI',
  'Fieldstone',
  'Cobalt Commerce',
  'Meridian Maps',
  'Pinecrest Bank',
  'Lumen Analytics',
  'Harbor Robotics',
  'Vantage Grid',
  'Sable Security',
  'Kestrel Travel',
  'Arcadia Games',
  'Bluefin Logistics',
  'Copperleaf',
  'Driftwood Studio',
  'Evergreen Energy',
  'Foxglove Bio',
  'Granite Cloud',
  'Helix Genomics',
  'Ironbark Systems',
  'Juniper Mobility',
  'Keystone Insurance',
  'Larkspur Media',
  'Monarch Retail',
  'Nimbus Weather',
  'Oakridge Learning',
  'Parallax Labs',
  'Quill Legal',
  'Riverstone Health',
] as const;
const ROLES = [
  'Backend Engineer',
  'Senior Backend Engineer',
  'Platform Engineer',
  'Staff Engineer',
  'Senior Software Engineer',
  'API Engineer',
  'Full-Stack Engineer',
  'Site Reliability Engineer',
  'Data Engineer',
  'Backend Engineer (Node)',
  'Senior Engineer, Payments',
  'Engineering Lead',
] as const;
const LOCATIONS = [
  'Remote',
  'Berlin',
  'London',
  'Amsterdam',
  'Dubai',
  'Remote (EU)',
  'Lisbon',
] as const;
const SOURCES = [
  'linkedin',
  'linkedin',
  'linkedin',
  'company_site',
  'company_site',
  'job_board',
  'referral',
  'recruiter_outreach',
  'networking',
  'other',
] as const;
const PEOPLE = [
  'Jane Doe',
  'Omar Haddad',
  'Priya Nair',
  'Lukas Weber',
  'Sofia Rossi',
  'Daniel Kim',
  'Amara Okafor',
  'Mateo García',
  'Hannah Becker',
  'Yusuf Demir',
  'Elena Petrova',
  'Chloe Martin',
] as const;

async function main(): Promise<void> {
  await connectToDatabase();

  // 1. Remove the previous demo account through the normal account-deletion path.
  const existing = await usersService.findByEmail(DEMO_EMAIL);
  if (existing) {
    await usersService.markDeletionRequested(existing._id.toString());
    await resumePendingDeletions();
  }

  // 2. A verified demo user.
  const user = await usersService.createUser({
    name: 'Ada Lovelace',
    email: DEMO_EMAIL,
    passwordHash: await hashPassword(DEMO_PASSWORD),
    timezone: process.env.SEED_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const userId = user._id;
  await UserModel.updateOne(
    { _id: userId },
    {
      $set: {
        emailVerifiedAt: new Date(),
        preferences: {
          targetTitles: ['Senior Backend Engineer', 'Platform Engineer'],
          targetLocations: ['Remote', 'Berlin'],
          workMode: 'remote',
          weeklyGoal: 15,
        },
      },
    },
  );

  // 3. Companies and contacts.
  const companies = COMPANIES.map((name) => ({
    _id: new Types.ObjectId(),
    userId,
    name,
    normalizedName: name.toLowerCase(),
    website: `https://${name.toLowerCase().replace(/[^a-z]+/g, '')}.example`,
    industry: pick(['Fintech', 'Logistics', 'Health', 'SaaS', 'AI', 'Media'] as const),
    location: pick(LOCATIONS),
    notes: null,
    createdAt: new Date(now - between(60, 110) * DAY),
    updatedAt: new Date(now - between(1, 50) * DAY),
  }));
  await CompanyModel.collection.insertMany(companies);

  const contacts = PEOPLE.map((name, i) => {
    const company = companies[i % companies.length] ?? companies[0];
    return {
      _id: new Types.ObjectId(),
      userId,
      companyId: company?._id ?? null,
      name,
      title: pick([
        'Technical Recruiter',
        'Talent Partner',
        'Engineering Manager',
        'Hiring Manager',
      ] as const),
      email: `${name.split(' ')[0]?.toLowerCase() ?? 'contact'}@${company?.website.slice(8) ?? 'example.com'}`,
      phone: null,
      linkedinUrl: `https://www.linkedin.com/in/${name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
      notes: null,
      createdAt: new Date(now - between(10, 80) * DAY),
      updatedAt: new Date(now - between(1, 9) * DAY),
    };
  });
  await ContactModel.collection.insertMany(contacts);

  // 4. Applications walking a believable funnel, with their timeline events.
  const applications: Record<string, unknown>[] = [];
  const activities: Record<string, unknown>[] = [];
  const event = (
    applicationId: Types.ObjectId,
    type: string,
    at: number,
    data: Record<string, unknown>,
  ) =>
    activities.push({
      _id: new Types.ObjectId(),
      userId,
      applicationId,
      contactId: null,
      type,
      data,
      occurredAt: new Date(at),
      createdAt: new Date(at),
    });

  for (let i = 0; i < 156; i++) {
    const company = pick(
      companies as unknown as readonly [
        (typeof companies)[number],
        ...(typeof companies)[number][],
      ],
    );
    const saved = i >= 148;
    const appliedMs = saved ? null : now - Math.floor(between(0, 90)) * DAY - between(1, 10) * HOUR;
    const cap = (ms: number) => Math.min(ms, now - HOUR);
    const path: { status: ApplicationStatus; at: number }[] = [];
    if (appliedMs !== null) {
      if (rand() < 0.31) {
        const respondedAt = cap(appliedMs + between(2, 10) * DAY);
        if (rand() < 0.35) path.push({ status: 'rejected', at: respondedAt });
        else {
          path.push({ status: 'screening', at: respondedAt });
          if (rand() < 0.55) {
            const interviewAt = cap(respondedAt + between(3, 8) * DAY);
            path.push({ status: 'interview', at: interviewAt });
            const r = rand();
            if (r < 0.16)
              path.push({ status: 'offer', at: cap(interviewAt + between(6, 14) * DAY) });
            else if (r < 0.45)
              path.push({ status: 'rejected', at: cap(interviewAt + between(4, 10) * DAY) });
          } else if (rand() < 0.5)
            path.push({ status: 'rejected', at: cap(respondedAt + between(3, 9) * DAY) });
        }
      } else if (now - appliedMs > 45 * DAY && rand() < 0.15) {
        path.push({ status: 'withdrawn', at: cap(appliedMs + between(20, 40) * DAY) });
      }
    }

    const createdMs = appliedMs ?? now - between(1, 20) * DAY;
    const start: ApplicationStatus = saved ? 'saved' : 'applied';
    let status: ApplicationStatus = start;
    let previousStatus: ApplicationStatus | null = null;
    let milestones = initialMilestones(start, new Date(createdMs));
    for (const step of path) {
      milestones = {
        ...milestones,
        ...milestonesReached(step.status, new Date(step.at), milestones),
      };
      previousStatus = status;
      status = step.status;
    }

    const interviews: Record<string, unknown>[] = [];
    if (milestones.interviewAt) {
      const rounds = 1 + Math.floor(rand() * 3);
      for (let round = 1; round <= rounds; round++) {
        const upcoming = round === rounds && status === 'interview' && rand() < 0.6;
        const slot = new Date(
          upcoming
            ? now + between(0.5, 6.5) * DAY
            : milestones.interviewAt.getTime() + (round - 1) * between(3, 6) * DAY,
        );
        slot.setHours(9 + Math.floor(rand() * 8), rand() < 0.5 ? 0 : 30, 0, 0);
        if (upcoming && slot.getTime() <= now) slot.setDate(slot.getDate() + 1);
        interviews.push({
          _id: new Types.ObjectId(),
          round,
          type: pick([
            'phone_screen',
            'technical',
            'system_design',
            'behavioral',
            'final',
          ] as const),
          scheduledAt: upcoming ? slot : new Date(Math.min(slot.getTime(), now - 2 * HOUR)),
          durationMinutes: pick([30, 45, 60, 90] as const),
          interviewers: [pick(PEOPLE)],
          outcome: upcoming
            ? 'pending'
            : status === 'rejected' && round === rounds
              ? 'failed'
              : 'passed',
          notes: '',
        });
      }
    }

    const minSalary = Math.round(between(60, 110)) * 1000;
    const contact = contacts.find((c) => c.companyId?.equals(company._id));
    const app = {
      _id: new Types.ObjectId(),
      userId,
      companyId: company._id,
      companyName: company.name,
      title: pick(ROLES),
      jobDescription:
        rand() < 0.5
          ? 'Own the services behind our core product: APIs, data models and the reliability work that keeps them fast.'
          : null,
      location: pick(LOCATIONS),
      workMode: pick(['remote', 'hybrid', 'onsite'] as const),
      employmentType: rand() < 0.85 ? 'full_time' : 'contract',
      salary:
        rand() < 0.55
          ? {
              min: minSalary,
              max: minSalary + 20_000,
              currency: pick(['EUR', 'GBP', 'USD'] as const),
              period: 'year',
            }
          : null,
      jobUrl:
        rand() < 0.7
          ? `${company.website.replace('https://', 'https://jobs.')}/${String(1000 + i)}`
          : null,
      source: pick(SOURCES),
      priority: pick(['low', 'medium', 'medium', 'high'] as const),
      status,
      previousStatus,
      appliedAt: appliedMs === null ? null : new Date(appliedMs),
      milestones,
      nextFollowUpAt: null as Date | null,
      contactIds: contact && rand() < 0.6 ? [contact._id] : [],
      interviews,
      archivedAt: null,
      external: null,
      version: path.length,
      createdAt: new Date(createdMs),
      updatedAt: new Date(path.at(-1)?.at ?? createdMs),
    };
    applications.push(app);

    const snapshot = { applicationTitle: app.title, companyName: app.companyName };
    event(app._id, 'created', createdMs, { status: start, ...snapshot });
    let from: ApplicationStatus = start;
    for (const step of path) {
      event(app._id, 'status_changed', step.at, { from, to: step.status, ...snapshot });
      from = step.status;
    }
  }

  // 5. Follow-ups: overdue, today and upcoming, on active applications.
  const active = applications.filter((a) =>
    ['applied', 'screening', 'interview', 'offer'].includes(a.status as string),
  );
  const HALF_HOUR = 30 * 60_000;
  const reminders = (
    [
      [-26 * HOUR, 'Follow up on the take-home'],
      [-3 * HOUR, 'Chase the recruiter for feedback'],
      [2 * HOUR, 'Send availability to the recruiter'],
      [5 * HOUR, 'Thank-you note after the panel'],
      [1 * DAY, 'Prepare system design examples'],
      [2 * DAY, 'Follow up on the application'],
      [3 * DAY, 'Research the team before round 2'],
      [5 * DAY, 'Ask about the salary band'],
    ] as const
  ).map(([offset, title], index) => ({
    _id: new Types.ObjectId(),
    userId,
    applicationId: (active[(index * 7) % active.length]?._id as Types.ObjectId | undefined) ?? null,
    title,
    note: '',
    dueAt: new Date(Math.round((now + offset) / HALF_HOUR) * HALF_HOUR),
    status: 'pending',
    completedAt: null,
    createdAt: new Date(now - 5 * DAY),
    updatedAt: new Date(now - 5 * DAY),
  }));
  for (const app of applications) {
    const due = reminders
      .filter((r) => r.applicationId?.equals(app._id as Types.ObjectId))
      .map((r) => r.dueAt.getTime());
    if (due.length) app.nextFollowUpAt = new Date(Math.min(...due));
  }

  await ApplicationModel.collection.insertMany(applications);
  await ActivityModel.collection.insertMany(activities);
  await ReminderModel.collection.insertMany(reminders);

  console.log(
    `Seeded ${DEMO_EMAIL} / ${DEMO_PASSWORD}: ${String(applications.length)} applications, ${String(companies.length)} companies, ${String(contacts.length)} contacts, ${String(reminders.length)} reminders.`,
  );
}

try {
  await main();
} finally {
  await disconnectFromDatabase();
}
