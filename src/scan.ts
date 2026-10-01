/**
 * The one lexer every post-pass shares.
 *
 * sql-formatter does not expose its token stream, so the passes that run on
 * its output (ordinal replacement, function re-joining, comma moving) need to
 * re-discover which characters are code. Doing that with three hand-written
 * scanners let them drift apart — and treating `\` as an escape in a
 * PostgreSQL `'C:\'` flipped string state and rewrote literal contents. This
 * scanner instead mirrors sql-formatter's own rules for the chosen dialect,
 * read from its public dialect objects (string / identifier quote types, line
 * comment markers, nested block comments), and matches the configured
 * placeholder patterns first, exactly as sql-formatter's tokenizer does.
 */
import * as sqlFormatter from 'sql-formatter';
import type { DialectOptions } from 'sql-formatter';

/** Character classes recorded per character of the scanned text. */
export const Kind = {
  Code: 0,
  /** A string literal or a quoted identifier. */
  Quoted: 1,
  LineComment: 2,
  BlockComment: 3,
  Placeholder: 4,
} as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

type QuoteType =
  | string
  | { quote: string; prefixes: string[]; requirePrefix?: boolean }
  | { regex: string };

// Same table as sql-formatter's lexer/regexFactory.ts quotePatterns.
const QUOTE_PATTERNS: Record<string, string> = {
  '``': '(?:`[^`]*`)+',
  '[]': String.raw`(?:\[[^\]]*\])(?:\][^\]]*\])*`,
  '""-qq': String.raw`(?:"[^"]*")+`,
  '""-bs': String.raw`(?:"[^"\\]*(?:\\.[^"\\]*)*")`,
  '""-qq-bs': String.raw`(?:"[^"\\]*(?:\\.[^"\\]*)*")+`,
  '""-raw': String.raw`(?:"[^"]*")`,
  "''-qq": String.raw`(?:'[^']*')+`,
  "''-bs": String.raw`(?:'[^'\\]*(?:\\.[^'\\]*)*')`,
  "''-qq-bs": String.raw`(?:'[^'\\]*(?:\\.[^'\\]*)*')+`,
  "''-raw": String.raw`(?:'[^']*')`,
  $$: String.raw`(?<tag>\$\w*\$)[\s\S]*?\k<tag>`,
  "'''..'''": String.raw`'''[^\\]*?(?:\\.[^\\]*?)*?'''`,
  '""".."""': String.raw`"""[^\\]*?(?:\\.[^\\]*?)*?"""`,
  '{}': String.raw`(?:\{[^\}]*\})`,
  "q''": String.raw`[Qq]'(?:(?<qtag>[^\s<\[({])(?:(?!\k<qtag>').)*?\k<qtag>|<(?:(?!>').)*?>|\[(?:(?!\]').)*?\]|\((?:(?!\)').)*?\)|\{(?:(?!\}').)*?\})'`,
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const caseInsensitive = (prefix: string): string =>
  prefix
    .split('')
    .map((ch) => (ch === ' ' ? '\\s+' : `[${ch.toUpperCase()}${ch.toLowerCase()}]`))
    .join('');

function quotePattern(type: QuoteType): string {
  if (typeof type === 'string') return QUOTE_PATTERNS[type] ?? '(?!)';
  if ('regex' in type) return type.regex;
  const prefixes = `(?:${type.prefixes.map(caseInsensitive).join('|')}${type.requirePrefix ? '' : '|'})`;
  return prefixes + (QUOTE_PATTERNS[type.quote] ?? '(?!)');
}

function quoteRegex(types: readonly QuoteType[] | undefined): RegExp | undefined {
  if (types === undefined || types.length === 0) return undefined;
  return new RegExp(`(?:${types.map(quotePattern).join('|')})`, 'uy');
}

/** sql-formatter's dialect object for a language name (`tsql` is an alias). */
export function dialectOptions(dialect: string): DialectOptions | undefined {
  const name = dialect === 'tsql' ? 'transactsql' : dialect;
  const candidate = (sqlFormatter as unknown as Record<string, unknown>)[name];
  if (typeof candidate !== 'object' || candidate === null || !('tokenizerOptions' in candidate)) {
    return undefined;
  }
  return candidate as DialectOptions;
}

const IDENT_CHAR = /[\p{L}\p{N}_$]/u;

export interface Lexer {
  /** One {@link Kind} per UTF-16 code unit of `text`. */
  scan(text: string): Uint8Array;
}

export function createLexer(dialect: string, placeholderPatterns: readonly string[]): Lexer {
  const options = dialectOptions(dialect)?.tokenizerOptions;
  const placeholders = placeholderPatterns.map((p) => new RegExp(`(?:${p})`, 'uy'));
  const lineComment = new RegExp(
    `(?:${(options?.lineCommentTypes ?? ['--']).map(escapeRegExp).join('|')})[^\\r\\n]*`,
    'uy'
  );
  const identifiers = quoteRegex(options?.identTypes as QuoteType[] | undefined);
  const strings = quoteRegex(options?.stringTypes as QuoteType[] | undefined);
  const nested = options?.nestedBlockComments === true;

  const matchAt = (regex: RegExp | undefined, text: string, i: number): number => {
    if (regex === undefined) return 0;
    regex.lastIndex = i;
    const match = regex.exec(text);
    return match === null ? 0 : match[0].length;
  };

  const blockCommentEnd = (text: string, i: number): number => {
    let depth = 1;
    let j = i + 2;
    while (j < text.length) {
      if (text[j] === '*' && text[j + 1] === '/') {
        depth -= 1;
        j += 2;
        if (depth === 0) return j;
      } else if (nested && text[j] === '/' && text[j + 1] === '*') {
        depth += 1;
        j += 2;
      } else {
        j += 1;
      }
    }
    return -1; // unterminated: sql-formatter would have failed, treat as code
  };

  return {
    scan(text: string): Uint8Array {
      const kinds = new Uint8Array(text.length);
      let i = 0;
      while (i < text.length) {
        const ch = text[i] as string;
        // A token can only start where sql-formatter's tokenizer would be:
        // not in the middle of an identifier (`name'x'` holds no string).
        if (i > 0 && IDENT_CHAR.test(ch) && IDENT_CHAR.test(text[i - 1] as string)) {
          i += 1;
          continue;
        }
        let length = 0;
        let kind: Kind = Kind.Code;
        for (const regex of placeholders) {
          length = matchAt(regex, text, i);
          if (length > 0) {
            kind = Kind.Placeholder;
            break;
          }
        }
        if (length === 0 && ch === '/' && text[i + 1] === '*') {
          const end = blockCommentEnd(text, i);
          if (end !== -1) {
            length = end - i;
            kind = Kind.BlockComment;
          }
        }
        if (length === 0 && (length = matchAt(lineComment, text, i)) > 0) kind = Kind.LineComment;
        if (length === 0 && (length = matchAt(identifiers, text, i)) > 0) kind = Kind.Quoted;
        if (length === 0 && (length = matchAt(strings, text, i)) > 0) kind = Kind.Quoted;
        if (length === 0) {
          i += 1;
          continue;
        }
        kinds.fill(kind, i, i + length);
        i += length;
      }
      return kinds;
    },
  };
}

/** Consecutive runs of one {@link Kind}. */
export function* runs(kinds: Uint8Array): Generator<{ kind: Kind; start: number; end: number }> {
  let start = 0;
  while (start < kinds.length) {
    const kind = kinds[start] as Kind;
    let end = start + 1;
    while (end < kinds.length && kinds[end] === kind) end += 1;
    yield { kind, start, end };
    start = end;
  }
}
