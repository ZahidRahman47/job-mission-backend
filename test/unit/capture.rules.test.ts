// Stage A rules: real confirmation emails (as Gmail's plain-text body) -> extracted application.
import { describe, expect, it } from 'vitest';
import { extractByRules, senderAddress } from '../../src/modules/capture/capture.rules.ts';

const sentAt = new Date('2026-10-25T13:06:00Z');

// Zahid's real Indeed Apply confirmation (2026-10-25), as getPlainBody() renders it.
const indeedText = `Application submitted

Front-End Design Engineer <https://www.indeed.com/rc/clk?jk=abc123>

Python Technologies <https://www.indeed.com/cmp/Python-Technologies> - Islamabad
Dha Phase-Ii

The following items were sent to Python Technologies. Good luck!

 * Application
 * CV

Next steps

 * The employer or job advertiser may reach out to you about your application.

Never share financial info or take job offers without an interview.`;

function indeed(overrides: Partial<Parameters<typeof extractByRules>[0]> = {}) {
  return {
    direction: 'received' as const,
    from: 'Indeed Apply <indeedapply@indeed.com>',
    subject: 'Indeed Application: Front-End Design Engineer',
    text: indeedText,
    sentAt,
    ...overrides,
  };
}

describe('senderAddress', () => {
  it('takes the address out of a display-name header, lowercased', () => {
    expect(senderAddress('"Indeed Apply" <IndeedApply@Indeed.com>')).toBe('indeedapply@indeed.com');
    expect(senderAddress('jobs@rozee.pk')).toBe('jobs@rozee.pk');
  });
});

describe('Indeed Apply confirmation', () => {
  it('extracts title, company, location and the applied time', () => {
    expect(extractByRules(indeed())).toEqual({
      kind: 'application_confirmation',
      source: 'indeed',
      company: 'Python Technologies',
      title: 'Front-End Design Engineer',
      location: 'Islamabad',
      appliedAt: sentAt,
    });
  });

  it('works when the plain-text body has no links', () => {
    const text = indeedText.replace(/ <https:[^>]+>/g, '');
    expect(extractByRules(indeed({ text }))).toMatchObject({
      company: 'Python Technologies',
      location: 'Islamabad',
    });
  });

  it('keeps going without a location line', () => {
    const text = indeedText.replace(/^Python Technologies <[^>]+> - Islamabad$/m, '');
    expect(extractByRules(indeed({ text }))).toMatchObject({ location: null });
  });

  it('handles company names with regex characters and line breaks', () => {
    const text = indeedText
      .replaceAll('Python Technologies', 'C++ Labs (Pvt.) Ltd.')
      .replace('sent to C++ Labs (Pvt.) Ltd.', 'sent to C++ Labs\n(Pvt.) Ltd.');
    expect(extractByRules(indeed({ text }))).toMatchObject({
      company: 'C++ Labs (Pvt.) Ltd.',
      location: 'Islamabad',
    });
  });

  it('ignores look-alikes: other senders, sent mail, other subjects', () => {
    expect(extractByRules(indeed({ from: 'Indeed <alert@indeed.com>' }))).toBeNull();
    expect(
      extractByRules(indeed({ from: 'Indeed Apply <indeedapply@indeed.com.evil.pk>' })),
    ).toBeNull();
    expect(extractByRules(indeed({ direction: 'sent' }))).toBeNull();
    expect(extractByRules(indeed({ subject: '5 new jobs for Front-End Engineer' }))).toBeNull();
    expect(extractByRules(indeed({ text: 'Thanks for applying' }))).toBeNull();
  });
});
