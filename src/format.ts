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
  /** Re-join formatter-inserted line breaks inside word(...) groups so SUM(...) stays on one line. */
  keepFunctionsInline: boolean;
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
    lines[move.line + 1] = `${indent},${next.slice(indent.length)}`;
  }
  return lines.join('\n');
}

/**
 * Re-join the line breaks sql-formatter inserts inside `word(...)` groups so
 * `SUM(...)`, `COUNT(CASE … END)`, and friends stay on one line
 * (`keepFunctionsInline: true`).
 *
 * Only newlines in code state are removed; a newline inside a string, a
 * dollar quote, a block comment, or the line comment it terminates is copied
 * verbatim, so literal content and comment bodies are never rewritten.
 * ponytail: any `word (` opener counts as a function — `IN (…)` groups
 * collapse too, and there is no keyword blacklist.
 */
function rejoinFunctionCalls(text: string): string {
  const stack: boolean[] = []; // per open paren: true when a word(...) call owns it
  let out = '';
  let i = 0;

  const isCallOpener = (): boolean => {
    const match = /[A-Za-z_][A-Za-z0-9_]*\s*$/.exec(out);
    if (match === null) return false;
    const before = out.slice(0, match.index);
    return before === '' || !/[A-Za-z0-9_]$/.test(before);
  };

  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < text.length) {
        if (text[i] === quote && text[i + 1] === quote) {
          out += text[i] + text[i + 1];
          i += 2;
          continue;
        }
        out += text[i];
        i += 1;
        if (text[i - 1] === quote) break;
        if (text[i - 1] === '\\' && quote !== '`' && i < text.length) {
          out += text[i];
          i += 1;
        }
      }
      continue;
    }
    if (ch === '$') {
      DOLLAR_QUOTE.lastIndex = i;
      const dollar = DOLLAR_QUOTE.exec(text);
      if (dollar !== null) {
        const end = text.indexOf(dollar[0], i + dollar[0].length);
        const stop = end === -1 ? text.length : end + dollar[0].length;
        out += text.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if ((ch === '-' && text[i + 1] === '-') || ch === '#') {
      while (i < text.length && text[i] !== '\n') {
        out += text[i];
        i += 1;
      }
      if (i < text.length) {
        out += text[i]; // the newline ending a line comment stays verbatim
        i += 1;
      }
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      out += '/*';
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        out += text[i];
        i += 1;
      }
      if (i < text.length) {
        out += '*/';
        i += 2;
      }
      continue;
    }
    if (ch === '\n') {
      if (stack.includes(true)) {
        let indent = i + 1;
        while (indent < text.length && (text[indent] === ' ' || text[indent] === '\t')) {
          indent += 1;
        }
        let peek = indent;
        while (
          peek < text.length &&
          (text[peek] === '\n' || text[peek] === ' ' || text[peek] === '\t')
        ) {
          peek += 1;
        }
        const next = text[peek];
        const prev = out.slice(-1);
        i = indent; // swallow this newline and its indent
        // `(` and `,`/`)` need no separating space; everything else does.
        if (prev !== '(' && next !== ',' && next !== ')') out += ' ';
      } else {
        out += ch;
        i += 1;
      }
      continue;
    }
    if (ch === '(') {
      stack.push(isCallOpener());
      out += ch;
      i += 1;
      continue;
    }
    if (ch === ')') {
      stack.pop();
      out += ch;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
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
  const joined = config.keepFunctionsInline ? rejoinFunctionCalls(result) : result;
  const placed = config.commaPosition === 'before' ? moveCommasToLineStarts(joined) : joined;
  // sql-formatter re-prints the parse tree, so the final newline belongs to no
  // statement and gets dropped. Restore it when the input had one: a formatter
  // must not add or remove the file's last byte, or every run leaves a
  // "\ No newline at end of file" diff behind (and `--check` never passes).
  return sql.endsWith('\n') && !placed.endsWith('\n') ? `${placed}\n` : placed;
}
