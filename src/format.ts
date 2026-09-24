import { format, type KeywordCase, type SqlLanguage } from 'sql-formatter';
import { replaceOrdinals } from './ordinals';

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
}

export const DEFAULT_PLACEHOLDER_PATTERNS = [
  '\\$\\{[^}]+\\}',
  '\\{\\{[\\s\\S]*?\\}\\}',
  '\\{[^{}]*\\}',
  '%\\([^)]*\\)s',
  '%s',
];

export interface EditorOptions {
  tabSize: number;
  insertSpaces: boolean;
}

const DOLLAR_QUOTE = /\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/y;

/**
 * Move every wrapping separator comma to the front of the next line
 * (`commaPosition: 'before'`).
 *
 * The scan walks the whole text carrying string, dollar-quote, and comment
 * state across line breaks, so a comma inside `'…'` (even a multi-line one),
 * `$$…$$`, or a comment is never mistaken for a separator — this formatter
 * has no reformat-until-stable gate, so the scan itself must be exact.
 * ponytail: `#` opens a line comment in every dialect, so a PostgreSQL line
 * holding a `#` operator simply keeps its comma at the end; add dialect-aware
 * comment rules only if that ever matters.
 */
function moveCommasToLineStarts(text: string): string {
  const moves: Array<{ line: number; column: number }> = [];
  let line = 0;
  let lineStart = 0;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (ch === '\n') {
      line += 1;
      lineStart = i + 1;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < text.length) {
        if (text[i] === quote) {
          if (text[i + 1] === quote) {
            i += 2; // '' / "" / `` doubling stays inside the literal
            continue;
          }
          i += 1;
          break;
        }
        if (text[i] === '\\' && quote !== '`') {
          if (text[i + 1] === '\n') {
            line += 1;
            lineStart = i + 2;
          }
          i += 2;
          continue;
        }
        if (text[i] === '\n') {
          line += 1;
          lineStart = i + 1;
        }
        i += 1;
      }
      continue;
    }
    if (ch === '$') {
      DOLLAR_QUOTE.lastIndex = i;
      const dollar = DOLLAR_QUOTE.exec(text);
      if (dollar !== null) {
        const end = text.indexOf(dollar[0], i + dollar[0].length);
        const limit = end === -1 ? text.length : end;
        while (i < limit) {
          if (text[i] === '\n') {
            line += 1;
            lineStart = i + 1;
          }
          i += 1;
        }
        i = end === -1 ? text.length : end + dollar[0].length;
        continue;
      }
    }
    if ((ch === '-' && text[i + 1] === '-') || ch === '#') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') {
          line += 1;
          lineStart = i + 1;
        }
        i += 1;
      }
      if (i < text.length) i += 2;
      continue;
    }
    if (ch === ',') {
      const lineEnd = text.indexOf('\n', i);
      const stop = lineEnd === -1 ? text.length : lineEnd;
      const tail = text.slice(i + 1, stop);
      // Only the wrapping comma moves: nothing but whitespace (or a trailing
      // line comment) may follow it, and a lone comma already leads its line.
      if (/^[ \t]*(?:$|--|#)/.test(tail) && text.slice(lineStart, i).trim() !== '' && stop < text.length) {
        const nextStart = stop + 1;
        const nextEnd = text.indexOf('\n', nextStart);
        const nextLine = text.slice(nextStart, nextEnd === -1 ? text.length : nextEnd);
        if (nextLine.trim() !== '') moves.push({ line, column: i - lineStart });
      }
    }
    i += 1;
  }

  const lines = text.split('\n');
  for (const move of [...moves].reverse()) {
    const current = lines[move.line];
    const next = lines[move.line + 1];
    if (current === undefined || next === undefined) continue;
    lines[move.line] = `${current.slice(0, move.column)}${current.slice(move.column + 1)}`.trimEnd();
    const indent = /^[ \t]*/.exec(next)?.[0] ?? '';
    lines[move.line + 1] = `${indent}, ${next.slice(indent.length)}`;
  }
  return lines.join('\n');
}

export function formatSql(
  sql: string,
  config: FormatterConfig,
  editorOptions?: EditorOptions
): string {
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
  const result = config.replaceOrdinals ? replaceOrdinals(formatted) : formatted;
  const placed = config.commaPosition === 'before' ? moveCommasToLineStarts(result) : result;
  // sql-formatter re-prints the parse tree, so the final newline belongs to no
  // statement and gets dropped. Restore it when the input had one: a formatter
  // must not add or remove the file's last byte, or every run leaves a
  // "\ No newline at end of file" diff behind (and `--check` never passes).
  return sql.endsWith('\n') && !placed.endsWith('\n') ? `${placed}\n` : placed;
}
