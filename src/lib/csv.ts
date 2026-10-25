// CSV parse/stringify helpers and formula-injection escaping (FR-056, FR-058, threat T11).
import { CsvError, parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { ValidationError } from './errors.ts';

// Parses a CSV with a header row into objects keyed by lowercased header names.
// Malformed files (e.g. an unclosed quote) become a 400 that names the line.
export function parseCsv(text: string): { header: string[]; rows: Record<string, string>[] } {
  let header: string[] = [];
  try {
    const rows = parse<Record<string, string>>(text, {
      bom: true,
      trim: true,
      skip_empty_lines: true,
      columns: (names: string[]) => {
        header = names.map((name) => name.trim().toLowerCase());
        return header;
      },
    });
    return { header, rows };
  } catch (err) {
    if (err instanceof CsvError) {
      throw new ValidationError([
        { location: 'body', path: [], message: `Malformed CSV: ${err.message}` },
      ]);
    }
    throw err;
  }
}

// A cell starting with = + - @ (or tab/CR) is executed as a formula when the file is opened in
// Excel or Sheets, so `=HYPERLINK("http://evil", "click")` in a job title could attack the user.
// Prefixing an apostrophe makes the spreadsheet treat it as plain text.
export function escapeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  return stringify([
    header,
    ...rows.map((row) =>
      row.map((cell) => (typeof cell === 'string' ? escapeFormula(cell) : (cell ?? ''))),
    ),
  ]);
}
