// Stage A rules on Zahid's real confirmation emails, as the Gmail script delivers them
// (getPlainBody() text, plus the HTML part converted by htmlToText()).
import { describe, expect, it } from 'vitest';
import { extractByRules, senderAddress } from '../../src/modules/capture/capture.rules.ts';
import { htmlToText } from '../../src/modules/capture/html-to-text.ts';

const sentAt = new Date('2026-10-25T13:06:00Z');

// --- Indeed Apply (2026-10-25) ----------------------------------------------------------------

// The real plain-text part: no company, no location.
const indeedPlain =
  "Your application has been submitted. Good luck!\r\nIf you notice an error in your application, please Contact Indeed <https://apply.indeed.com/indeedapply/confirmemail/contactus?iaUid=x&apiToken=y>\r\n\r\n------\r\n\r\nIndeed - one search. all jobs. | Indeed Ireland Operations Limited, Block B, Capital Dock, 80 Sir John Rogerson's Quay, Grand Canal Dock, Dublin 2, D02 HE36, Ireland";

// The HTML part, in the table layout the email renders with.
const indeedHtml = `<html><head><title>Indeed</title><style>.h{font:24px Arial}</style></head><body>
<table role="presentation"><tr><td><img src="https://indeed.com/logo.png" alt="indeed"></td></tr>
<tr><td><table><tr><td><img alt="" src="check.png"> Application submitted</td></tr>
<tr><td><h1 class="h"><a href="https://www.indeed.com/viewjob?jk=abc">Front-End Engineer</a></h1></td><td><img alt="" src="art.png"></td></tr>
<tr><td><a href="https://www.indeed.com/cmp/Python-Technologies">Python Technologies</a> - Islamabad<br>Dha Phase-Ii</td></tr>
</table></td></tr>
<tr><td><p>The following items were sent to Python&nbsp;Technologies. Good luck!</p><ul><li>Application</li><li>CV</li></ul></td></tr>
<tr><td><p>Next steps</p><ul><li>The employer or job advertiser may reach out to you about your application.</li></ul></td></tr>
</table></body></html>`;

function indeed(overrides: Partial<Parameters<typeof extractByRules>[0]> = {}) {
  return {
    direction: 'received' as const,
    from: 'Indeed Apply <indeedapply@indeed.com>',
    subject: 'Indeed Application: Front-End Engineer',
    text: indeedPlain,
    htmlText: htmlToText(indeedHtml),
    sentAt,
    ...overrides,
  };
}

// --- LinkedIn (2026-10-25) --------------------------------------------------------------------

// The real plain-text part (tracking parameters shortened).
const linkedinPlain =
  'Your application was sent to TenX\r\n\r\nSenior Software Engineer\r\nTenX\r\nLahore\r\nView job: https://www.linkedin.com/comm/jobs/view/4478682486/?trackingId=%2FJ3H4IsdS6qmfv3X92aN5Q%3D%3D&refId=4Od&trk=eml-email_application_confirmation_with_nba_01\r\n\r\n---------------------------------------------------------\r\n  \r\nApplied on October 25, 2026----------------------------------------------------------------\r\n        Now, take these next steps for more success\r\n\r\n\r\n\r\nView similar jobs you may be interested in\r\n            \r\nFull Stack Engineer (TypeScript, AI-Native)\r\nDataspecc\r\nPakistan\r\nView job: https://www.linkedin.com/comm/jobs/view/4478908565/?trackingId=sl';

// The HTML part's layout, as rendered in Gmail.
const linkedinHtml = `<table><tr><td><h2>Your application was sent to TenX</h2></td></tr>
<tr><td><img alt="TenX"></td><td><a href="https://www.linkedin.com/comm/jobs/view/4478682486/?trk=x">Senior Software Engineer</a><br>TenX &middot; Lahore (On-site)<p>Applied on October 25, 2026</p></td></tr>
<tr><td><h2>Now, take these next steps for more success</h2><p>View similar jobs you may be interested in</p></td></tr>
<tr><td><a href="https://www.linkedin.com/comm/jobs/view/4478908565/">Full Stack Engineer (TypeScript, AI-Native)</a><br>Dataspecc &middot; Pakistan (Remote)</td></tr></table>`;

function linkedin(overrides: Partial<Parameters<typeof extractByRules>[0]> = {}) {
  return {
    direction: 'received' as const,
    from: 'LinkedIn <jobs-noreply@linkedin.com>',
    subject: 'zahid, your application was sent to TenX',
    text: linkedinPlain,
    htmlText: htmlToText(linkedinHtml),
    sentAt,
    ...overrides,
  };
}

describe('htmlToText', () => {
  it('keeps block structure as lines, drops styles and tags, decodes entities', () => {
    const text = htmlToText(indeedHtml);
    expect(text).not.toContain('font:24px');
    expect(text).not.toContain('<');
    expect(text).toContain('Front-End Engineer');
    expect(text).toMatch(/^Python Technologies - Islamabad$/m);
    expect(text).toMatch(/^Dha Phase-Ii$/m);
    expect(text).toContain('The following items were sent to Python Technologies. Good luck!');
    expect(htmlToText('<p>A &amp; B &#39;x&#39; &#x41;</p>')).toBe("A & B 'x' A");
    expect(htmlToText('')).toBe('');
  });
});

describe('senderAddress', () => {
  it('takes the address out of a display-name header, lowercased', () => {
    expect(senderAddress('"Indeed Apply" <IndeedApply@Indeed.com>')).toBe('indeedapply@indeed.com');
    expect(senderAddress('jobs@rozee.pk')).toBe('jobs@rozee.pk');
  });
});

describe('Indeed Apply confirmation', () => {
  it('takes the title from the subject and company + location from the HTML part', () => {
    expect(extractByRules(indeed())).toEqual({
      kind: 'application_confirmation',
      source: 'indeed',
      company: 'Python Technologies',
      title: 'Front-End Engineer',
      location: 'Islamabad',
      workMode: null,
      jobUrl: null,
      appliedAt: sentAt,
    });
  });

  it('finds the location when the dash wraps onto the next line', () => {
    const html = indeedHtml.replace('</a> - Islamabad', '</a><br>- Islamabad');
    expect(extractByRules(indeed({ htmlText: htmlToText(html) }))).toMatchObject({
      location: 'Islamabad',
    });
  });

  it('creates nothing from the plain-text part alone (it has no company)', () => {
    expect(extractByRules(indeed({ htmlText: '' }))).toBeNull();
  });

  it('handles company names with regex characters', () => {
    const html = indeedHtml.replaceAll(/Python(?: |&nbsp;)Technologies/g, 'C++ Labs (Pvt.) Ltd.');
    expect(extractByRules(indeed({ htmlText: htmlToText(html) }))).toMatchObject({
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
  });
});

describe('LinkedIn application confirmation', () => {
  const expected = {
    kind: 'application_confirmation',
    source: 'linkedin',
    company: 'TenX',
    title: 'Senior Software Engineer',
    location: 'Lahore',
    workMode: null,
    jobUrl: 'https://www.linkedin.com/jobs/view/4478682486/',
    appliedAt: sentAt,
  };

  it('reads the real plain-text layout: title / company / location / View job', () => {
    expect(extractByRules(linkedin())).toEqual(expected);
  });

  it('falls back to the HTML layout "company · location (mode)" (no job link in converted HTML)', () => {
    expect(extractByRules(linkedin({ text: '' }))).toEqual({
      ...expected,
      workMode: 'onsite',
      jobUrl: null,
    });
  });

  it('never picks a job from the "similar jobs" list', () => {
    const ownJobRemoved = linkedinPlain.replace(
      'Senior Software Engineer\r\nTenX\r\nLahore\r\n',
      '',
    );
    expect(extractByRules(linkedin({ text: ownJobRemoved, htmlText: '' }))).toBeNull();
    // Even when the similar job is at the same company.
    const sameCompany = ownJobRemoved.replace('Dataspecc', 'TenX');
    expect(extractByRules(linkedin({ text: sameCompany, htmlText: '' }))).toBeNull();
  });

  it('works without a location line or job link', () => {
    const text = linkedinPlain.replace('Lahore\r\n', '').replace(/View job: \S+\r\n/, '');
    expect(extractByRules(linkedin({ text, htmlText: '' }))).toMatchObject({
      title: 'Senior Software Engineer',
      location: null,
      jobUrl: null,
    });
  });

  it('ignores other LinkedIn emails (job alerts, messages)', () => {
    expect(extractByRules(linkedin({ subject: '30+ new jobs for Software Engineer' }))).toBeNull();
    expect(
      extractByRules(linkedin({ from: 'LinkedIn <jobalerts-noreply@linkedin.com>' })),
    ).toBeNull();
  });
});
