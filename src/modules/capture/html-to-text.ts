// Turns an email's HTML body into plain text lines for the rules. Some senders (Indeed Apply)
// put the company and location only in the HTML part, never in the plain-text part.
// Converted at ingest, so improving this never requires users to reinstall the Gmail script.

// Elements that start a new line. Table cells stay on the same line, separated by a space.
const LINE_BREAK =
  /<\/?(?:p|div|br|tr|table|tbody|thead|tfoot|h[1-6]|li|ul|ol|section|article|header|footer|center|blockquote|hr)\b[^>]*>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  middot: '·',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  zwnj: '',
  zwj: '',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    }
    if (code.startsWith('#')) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

// Zero-width and combining characters email templates use as invisible spacers.
const INVISIBLE = /\u200b|\u200c|\u200d|\u034f|\ufeff/g;

export function htmlToText(html: string): string {
  if (!html) return '';
  const withoutTags = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<td\b[^>]*>/gi, ' ')
    .replace(LINE_BREAK, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(withoutTags)
    .split('\n')
    .map((line) => line.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
