import { format, supportedDialects, type KeywordCase, type SqlLanguage } from 'sql-formatter';
import { replaceOrdinals } from './ordinals';
import { createLexer, Kind } from './scan';

type ParamTypes = {
  positional?: boolean;
  numbered?: ('?' | ':' | '$')[];
  named?: (':' | '@' | '$')[];
  quoted?: (':' | '@' | '$')[];
  custom?: Array<{ regex: string; key?: (text: string) => string }>;
};

export type Dialect = SqlLanguage;

export interface FormatterConfig {
  dialect: string;
  placeholderPatterns: string[];
  namedPrefixes: string[];
  keywordCase: string;
  replaceOrdinals: boolean;
  /** Where a wrapping comma sits: 'after' (end of the previous line, default) or 'before' (start of the next line). */
  commaPosition: string;
  /** Re-join formatter-inserted line breaks inside word(...) groups so SUM(...) stays on one line. */
  keepFunctionsInline: boolean;
}

export const DEFAULT_PLACEHOLDER_PATTERNS = [
  '\\$\\{[^}]+\\}',
  '\\{\\{[\\s\\S]*?\\}\\}',
  '\\{[^{}]*\\}',
  '%\\([^)]*\\)s',
  '%s(?![A-Za-z0-9_])',
];

export interface EditorOptions {
  tabSize: number;
  insertSpaces: boolean;
}

export const KEYWORD_CASES = ['preserve', 'upper', 'lower'] as const;
export const COMMA_POSITIONS = ['after', 'before'] as const;
export const NAMED_PREFIXES = [':', '@', '$'] as const;

/** A setting that cannot be formatted with; the message names the setting and the bad value. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function expectOneOf(setting: string, value: unknown, allowed: readonly string[]): void {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ConfigError(
      `invalid ${setting} ${JSON.stringify(value)}: expected one of ${allowed.join(', ')}`
    );
  }
}

// Inputs probed for an empty match: '' alone misses lookaround-only patterns
// such as `(?=a)` that match nothing only next to certain characters.
const EMPTY_MATCH_PROBES = ['', ' ', '\n', 'a', 'Z', '0', '_', '{', '}', '$', '%', ':', '@', '?', '(', ')', "'", '"', ',', ';', '-', '#', 'select x'];

/**
 * A placeholder pattern must compile and must never match the empty string:
 * sql-formatter's tokenizer does not advance past an empty token and loops
 * forever, which in VS Code freezes the whole extension host.
 */
function validatePlaceholderPattern(pattern: unknown): void {
  if (typeof pattern !== 'string') {
    throw new ConfigError(`invalid placeholder pattern ${JSON.stringify(pattern)}: expected a string`);
  }
  let regex: RegExp;
  try {
    regex = new RegExp(`(?:${pattern})`, 'uy');
  } catch (err) {
    throw new ConfigError(`invalid placeholder pattern ${JSON.stringify(pattern)}: ${(err as Error).message}`);
  }
  for (const probe of EMPTY_MATCH_PROBES) {
    for (let i = 0; i <= probe.length; i += 1) {
      regex.lastIndex = i;
      if (regex.exec(probe)?.[0] === '') {
        throw new ConfigError(
          `invalid placeholder pattern ${JSON.stringify(pattern)}: it can match an empty string, which would hang the formatter`
        );
      }
    }
  }
}

/**
 * Reject settings sql-formatter would mishandle instead of failing loudly:
 * an unknown `keywordCase` makes it drop every keyword from the output, and a
 * non-numeric tab width silently removes all indentation.
 */
export function validateConfig(config: FormatterConfig, editorOptions?: EditorOptions): void {
  expectOneOf('dialect', config.dialect, supportedDialects);
  expectOneOf('keywordCase', config.keywordCase, KEYWORD_CASES);
  expectOneOf('commaPosition', config.commaPosition, COMMA_POSITIONS);
  for (const prefix of config.namedPrefixes) expectOneOf('namedPrefixes entry', prefix, NAMED_PREFIXES);
  for (const pattern of config.placeholderPatterns) validatePlaceholderPattern(pattern);
  if (editorOptions !== undefined) {
    const { tabSize } = editorOptions;
    if (!Number.isInteger(tabSize) || tabSize < 1) {
      throw new ConfigError(`invalid tab width ${String(tabSize)}: expected a positive integer`);
    }
  }
}

/**
 * Move every wrapping separator comma to the front of the next code line
 * (`commaPosition: 'before'`).
 *
 * Only a code comma (per the shared lexer, so never one inside a string, a
 * dollar quote, a comment, or a placeholder) that ends its line — optionally
 * followed by a line comment — moves. Comment-only lines between it and the
 * next item are stepped over, so the comma lands on the item, not the comment.
 */
function moveCommasToLineStarts(text: string, kinds: Uint8Array): string {
  const lines = text.split('\n');
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const isBlank = (ch: string | undefined): boolean => ch === ' ' || ch === '\t' || ch === '\r';
  const isComment = (kind: number | undefined): boolean =>
    kind === Kind.LineComment || kind === Kind.BlockComment;

  /** Column where the line's first item starts, `null` for a blank line, `undefined` for a comment-only line. */
  const itemColumn = (index: number): number | null | undefined => {
    const line = lines[index] ?? '';
    const base = starts[index] ?? 0;
    let sawComment = false;
    for (let c = 0; c < line.length; c += 1) {
      if (isComment(kinds[base + c])) {
        sawComment = true;
      } else if (!isBlank(line[c])) {
        // An item behind a comment on the same line: leave the comma alone.
        return sawComment ? null : c;
      }
    }
    return sawComment ? undefined : null;
  };

  const removals: Array<{ line: number; column: number }> = [];
  const inserts = new Map<number, number>();
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index] ?? '';
    const base = starts[index] ?? 0;
    for (let c = line.length - 1; c >= 0; c -= 1) {
      if (line[c] !== ',' || kinds[base + c] !== Kind.Code) continue;
      let tail = c + 1;
      while (tail < line.length && isBlank(line[tail])) tail += 1;
      if (tail < line.length && kinds[base + tail] !== Kind.LineComment) continue;
      if (line.slice(0, c).trim() === '') continue; // a lone comma already leads its line
      let target = index + 1;
      let column = itemColumn(target);
      while (column === undefined && target < lines.length - 1) {
        target += 1;
        column = itemColumn(target);
      }
      if (column === null || column === undefined) continue;
      removals.push({ line: index, column: c });
      inserts.set(target, column);
    }
  }

  for (const { line, column } of removals) {
    const current = lines[line] ?? '';
    lines[line] = `${current.slice(0, column)}${current.slice(column + 1)}`.trimEnd();
  }
  for (const [line, column] of inserts) {
    const current = lines[line] ?? '';
    lines[line] = `${current.slice(0, column)}, ${current.slice(column)}`;
  }
  return lines.join('\n');
}

const WORD_CHAR = /[\p{L}\p{N}_$]/u;

/**
 * Re-join the line breaks sql-formatter inserts inside `word(...)` groups so
 * `SUM(...)`, `COUNT(CASE … END)`, and friends stay on one line
 * (`keepFunctionsInline: true`).
 *
 * Only code newlines are removed; anything the lexer marks as a string, a
 * dollar quote, a comment, or a placeholder is copied verbatim, and the
 * newline that ends a line comment stays so no code gets commented out.
 *
 * A paren is a call only when a word touches it (`SUM(`): sql-formatter prints
 * function calls without a space but keyword parens with one (`AS (`,
 * `IN (`, `EXISTS (`, `OVER (`) and a derived table's `(` on its own line, so
 * CTE bodies and subqueries keep their layout.
 */
function rejoinFunctionCalls(text: string, kinds: Uint8Array): string {
  const stack: boolean[] = []; // per open paren: true when a word(...) call owns it
  let calls = 0;
  const out: string[] = [];
  let last = '';

  const isCallOpener = (open: number): boolean =>
    open > 0 && kinds[open - 1] === Kind.Code && WORD_CHAR.test(text[open - 1] as string);

  let i = 0;
  while (i < text.length) {
    if (kinds[i] !== Kind.Code) {
      let end = i + 1;
      while (end < text.length && kinds[end] !== Kind.Code) end += 1;
      out.push(text.slice(i, end));
      last = text[end - 1] as string;
      i = end;
      continue;
    }
    const ch = text[i] as string;
    if (ch === '\n' && calls > 0 && kinds[i - 1] !== Kind.LineComment) {
      let indent = i + 1;
      while (indent < text.length && (text[indent] === ' ' || text[indent] === '\t')) indent += 1;
      let peek = indent;
      while (peek < text.length && /[\n \t]/.test(text[peek] as string)) peek += 1;
      const next = text[peek];
      i = indent; // swallow this newline and its indent
      // `(` and `,`/`)` need no separating space; everything else does.
      if (last !== '(' && next !== ',' && next !== ')') {
        out.push(' ');
        last = ' ';
      }
      continue;
    }
    if (ch === '(') {
      const opener = isCallOpener(i);
      stack.push(opener);
      if (opener) calls += 1;
    } else if (ch === ')') {
      if (stack.pop() === true) calls -= 1;
    }
    out.push(ch);
    last = ch;
    i += 1;
  }
  return out.join('');
}

export function formatSql(
  sql: string,
  config: FormatterConfig,
  editorOptions?: EditorOptions
): string {
  validateConfig(config, editorOptions);
  const paramTypes: ParamTypes = {};
  if (config.placeholderPatterns.length > 0) {
    paramTypes.custom = config.placeholderPatterns.map((regex) => ({ regex }));
  }
  if (config.namedPrefixes.length > 0) {
    paramTypes.named = config.namedPrefixes as ParamTypes['named'];
  }
  const formatted = format(sql, {
    language: config.dialect as Dialect,
    keywordCase: config.keywordCase as KeywordCase,
    tabWidth: editorOptions?.tabSize ?? 2,
    useTabs: editorOptions ? !editorOptions.insertSpaces : false,
    paramTypes,
  });
  const lexer = createLexer(config.dialect, config.placeholderPatterns);
  const result = config.replaceOrdinals
    ? replaceOrdinals(formatted, lexer.scan(formatted))
    : formatted;
  const joined = config.keepFunctionsInline
    ? rejoinFunctionCalls(result, lexer.scan(result))
    : result;
  const placed =
    config.commaPosition === 'before' ? moveCommasToLineStarts(joined, lexer.scan(joined)) : joined;
  // sql-formatter re-prints the parse tree, so the final newline belongs to no
  // statement and gets dropped. Restore it when the input had one: a formatter
  // must not add or remove the file's last byte, or every run leaves a
  // "\ No newline at end of file" diff behind (and `--check` never passes).
  return sql.endsWith('\n') && !placed.endsWith('\n') ? `${placed}\n` : placed;
}
