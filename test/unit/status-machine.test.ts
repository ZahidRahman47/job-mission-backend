// BR-001 to BR-007 as pure unit tests: every one of the 64 status pairs is checked.
import { describe, expect, it } from 'vitest';
import { APPLICATION_STATUSES } from '../../src/modules/applications/applications.constants.ts';
import {
  allowedTransitions,
  EMPTY_MILESTONES,
  initialMilestones,
  isReopen,
  milestonesReached,
} from '../../src/modules/applications/status-machine.ts';

const ALLOWED: Record<string, string[]> = {
  saved: ['applied', 'withdrawn'],
  applied: ['screening', 'interview', 'offer', 'rejected', 'withdrawn'],
  screening: ['interview', 'offer', 'rejected', 'withdrawn'],
  interview: ['offer', 'rejected', 'withdrawn'],
  offer: ['accepted', 'rejected', 'withdrawn'],
  accepted: [],
  rejected: [],
  withdrawn: [],
};

describe('allowed transitions', () => {
  for (const from of APPLICATION_STATUSES) {
    for (const to of APPLICATION_STATUSES) {
      const expected = ALLOWED[from]?.includes(to) ?? false;
      it(`${from} -> ${to} is ${expected ? 'allowed' : 'rejected'}`, () => {
        expect(allowedTransitions(from, null).includes(to)).toBe(expected);
      });
    }
  }

  it('lets rejected and withdrawn reopen to the previous status only (BR-003)', () => {
    expect(allowedTransitions('rejected', 'interview')).toEqual(['interview']);
    expect(allowedTransitions('withdrawn', 'offer')).toEqual(['offer']);
    expect(isReopen('rejected', 'interview', 'interview')).toBe(true);
    expect(isReopen('rejected', 'offer', 'interview')).toBe(false);
  });

  it('never reopens an accepted application', () => {
    expect(allowedTransitions('accepted', 'offer')).toEqual([]);
  });
});

describe('milestones', () => {
  const at = new Date('2026-10-25T10:00:00Z');
  const earlier = new Date('2026-10-01T10:00:00Z');

  it('counts screening, interview, offer and rejection as a response, not withdrawal (BR-006)', () => {
    for (const status of ['screening', 'interview', 'offer', 'rejected'] as const) {
      expect(milestonesReached(status, at, EMPTY_MILESTONES).respondedAt).toEqual(at);
    }
    expect(milestonesReached('withdrawn', at, EMPTY_MILESTONES).respondedAt).toBeUndefined();
    expect(milestonesReached('withdrawn', at, EMPTY_MILESTONES).closedAt).toEqual(at);
  });

  it('never overwrites a milestone that is already set (BR-005)', () => {
    const current = { ...EMPTY_MILESTONES, respondedAt: earlier, interviewAt: earlier };
    expect(milestonesReached('interview', at, current)).toEqual({});
  });

  it('sets implied milestones when created directly in a later status (BR-007)', () => {
    expect(initialMilestones('applied', at)).toEqual(EMPTY_MILESTONES);
    expect(initialMilestones('offer', at)).toEqual({
      respondedAt: at,
      screeningAt: null,
      interviewAt: at,
      offerAt: at,
      closedAt: null,
    });
    expect(initialMilestones('withdrawn', at)).toEqual({ ...EMPTY_MILESTONES, closedAt: at });
  });
});
