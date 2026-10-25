// BR-010, BR-011: "today" and local midnights in the user's timezone, including DST changes.
import { describe, expect, it } from 'vitest';
import { escapeFormula } from '../../src/lib/csv.ts';
import { decodeCursor, encodeCursor } from '../../src/lib/pagination.ts';
import { todayRange, zonedMidnight } from '../../src/lib/time.ts';
import { escapeRegex } from '../../src/lib/validation.ts';

describe('timezones', () => {
  it('puts 23:30 in Karachi (18:30 UTC) on the local day, not the UTC day', () => {
    const { start, end } = todayRange(new Date('2026-11-02T18:30:00Z'), 'Asia/Karachi');
    expect(start.toISOString()).toBe('2026-11-01T19:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-02T19:00:00.000Z');
  });

  it('handles the 23-hour day when New York starts daylight saving time', () => {
    const start = zonedMidnight({ year: 2026, month: 3, day: 8 }, 'America/New_York');
    const next = zonedMidnight({ year: 2026, month: 3, day: 9 }, 'America/New_York');
    expect(start.toISOString()).toBe('2026-03-08T05:00:00.000Z'); // EST, UTC-5
    expect(next.toISOString()).toBe('2026-03-09T04:00:00.000Z'); // EDT, UTC-4
  });
});

describe('small security helpers', () => {
  it('escapes spreadsheet formulas in CSV cells (T11)', () => {
    expect(escapeFormula('=HYPERLINK("http://evil")')).toBe('\'=HYPERLINK("http://evil")');
    expect(escapeFormula('+1 555')).toBe("'+1 555");
    expect(escapeFormula('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(escapeFormula('Acme Corp')).toBe('Acme Corp');
  });

  it('escapes regex metacharacters in search input (T10)', () => {
    expect(new RegExp(escapeRegex('a.*b')).test('aXXb')).toBe(false);
    expect(new RegExp(escapeRegex('a.*b')).test('a.*b')).toBe(true);
  });

  it('round-trips cursors and rejects tampered ones', () => {
    const cursor = { at: new Date('2026-10-25T10:00:00Z'), id: '6720f1c2a1b2c3d4e5f60718' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(() => decodeCursor('not-a-cursor')).toThrow('The request contains invalid fields.');
  });
});
