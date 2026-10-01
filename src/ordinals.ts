/** Replace GROUP BY / ORDER BY ordinal numbers with column names. */
import { Kind, runs } from "./scan";

interface SqlToken {
  readonly kind: Kind;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly depth: number;
}

interface SelectColumn {
  readonly expressionStart: number;
  readonly expressionEnd: number;
  readonly alias: string | undefined;
  readonly aggregate: boolean;
  /**
   * The item ends in a bare name that is neither clearly an implicit alias
   * nor clearly part of the expression (`INTERVAL 1 DAY`,
   * `x::double precision`): replacing its ordinal could change the query.
   */
  readonly uncertain: boolean;
}

interface Clause {
  readonly itemRanges: readonly (readonly [number, number])[];
}

interface PendingScope {
  readonly depth: number;
  readonly columns: SelectColumn[];
  phase: "select" | "from";
  /** Part of a UNION / EXCEPT / INTERSECT: its ORDER BY sorts the combined result. */
  setOperation: boolean;
  columnStart: number;
  activeClause: "group" | "order" | undefined;
  groupBy: Clause | undefined;
  orderBy: Clause | undefined;
  itemStart: number;
  itemRanges: [number, number][];
}

/** Tokens inside a code run; strings, comments, and placeholders come from the lexer. */
const CODE_TOKEN =
  /\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[\p{L}_][\p{L}\p{N}_$]*|,|;|\(|\)|\.|\[|\]|\{|\}|[<>!=+\-*/%:|&^~#@?]+/gu;

const AGGREGATE_FUNCTIONS = new Set([
  "any_value",
  "array_agg",
  "avg",
  "bit_and",
  "bit_or",
  "bool_and",
  "bool_or",
  "count",
  "every",
  "group_concat",
  "json_agg",
  "max",
  "min",
  "string_agg",
  "sum",
  "xmlagg",
]);

/** Directional / position suffixes allowed after an ordinal in ORDER BY / GROUP BY items. */
const ORDINAL_SUFFIXES = new Set(["asc", "desc", "nulls", "first", "last"]);

/** Keywords that can never be a column alias inside a select list. */
const RESERVED = new Set([
  "all",
  "and",
  "as",
  "asc",
  "between",
  "case",
  "desc",
  "distinct",
  "else",
  "end",
  "false",
  "from",
  "group",
  "having",
  "ilike",
  "in",
  "into",
  "is",
  "join",
  "left",
  "like",
  "limit",
  "not",
  "null",
  "offset",
  "on",
  "or",
  "order",
  "right",
  "then",
  "true",
  "union",
  "unknown",
  "when",
  "where",
  "zone",
]);

/**
 * Keywords that take an operand after them: a name following one of these is
 * that operand (`a IS NOT b`, `x LIKE y`, `a IS DISTINCT FROM b`,
 * `ts AT TIME ZONE zone_name`, `sum(x) OVER w`), never an implicit alias.
 */
const OPERAND_KEYWORDS = new Set([
  "and",
  "as",
  "at",
  "between",
  "case",
  "collate",
  "distinct",
  "div",
  "else",
  "escape",
  "from",
  "glob",
  "ilike",
  "in",
  "interval",
  "is",
  "like",
  "match",
  "mod",
  "not",
  "of",
  "or",
  "over",
  "overlaps",
  "regexp",
  "rlike",
  "similar",
  "then",
  "time",
  "to",
  "when",
  "xor",
  "zone",
]);

/** Keywords that can end an expression (`a IS NULL`, `CASE … END`). */
const TERMINAL_KEYWORDS = new Set(["end", "false", "isnull", "notnull", "null", "true", "unknown"]);

const SET_OPERATORS = new Set(["union", "except", "intersect", "minus"]);

/** Select-list modifiers that precede the first column (`SELECT DISTINCT a`). */
const SELECT_MODIFIERS = new Set([
  "all",
  "distinct",
  "distinctrow",
  "high_priority",
  "sql_big_result",
  "sql_buffer_result",
  "sql_cache",
  "sql_calc_found_rows",
  "sql_no_cache",
  "sql_small_result",
  "straight_join",
]);

function tokenize(sql: string, kinds: Uint8Array): SqlToken[] {
  const tokens: SqlToken[] = [];
  let depth = 0;
  for (const run of runs(kinds)) {
    if (run.kind !== Kind.Code) {
      tokens.push({
        kind: run.kind,
        text: sql.slice(run.start, run.end),
        start: run.start,
        end: run.end,
        depth,
      });
      continue;
    }
    const code = sql.slice(run.start, run.end);
    CODE_TOKEN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CODE_TOKEN.exec(code)) !== null) {
      const text = match[0];
      const start = run.start + match.index;
      tokens.push({ kind: Kind.Code, text, start, end: start + text.length, depth });
      if (text === "(") {
        depth += 1;
      } else if (text === ")") {
        depth -= 1;
      }
    }
  }
  return tokens;
}

function isKeyword(token: SqlToken, ...words: readonly string[]): boolean {
  const lower = token.text.toLowerCase();
  return words.some((word) => lower === word);
}

function isNumberToken(token: SqlToken): boolean {
  return /^\d/.test(token.text);
}

/** An ordinal is a plain positive integer: `1.5` and `1e0` are constants, not column numbers. */
function isOrdinalToken(token: SqlToken): boolean {
  return token.kind === Kind.Code && /^\d+$/.test(token.text);
}

function isPlaceholderToken(token: SqlToken): boolean {
  return token.kind === Kind.Placeholder;
}

function isNameToken(token: SqlToken): boolean {
  return token.kind === Kind.Code && /^[\p{L}_]/u.test(token.text);
}

/** Index of the nearest token before `index` that is not a comment, or -1. */
function previousCode(tokens: readonly SqlToken[], index: number): number {
  let j = index - 1;
  while (j >= 0 && isCommentToken(tokens[j] as SqlToken)) j -= 1;
  return j;
}

function isSelectStart(tokens: readonly SqlToken[], index: number): boolean {
  const p = previousCode(tokens, index);
  const previous = tokens[p];
  if (previous === undefined) return true;
  const text = previous.text.toLowerCase();
  if (text === "all" || text === "distinct") {
    return SET_OPERATORS.has(tokens[previousCode(tokens, p)]?.text.toLowerCase() ?? "");
  }
  return (
    text === "(" ||
    text === ";" ||
    text === ")" ||
    SET_OPERATORS.has(text) ||
    isPlaceholderToken(previous)
  );
}

/**
 * True when the SELECT at `index` is a later operand of UNION / EXCEPT /
 * INTERSECT. Comments between the operator and the SELECT are skipped.
 */
function followsSetOperator(tokens: readonly SqlToken[], index: number): boolean {
  let p = previousCode(tokens, index);
  let previous = tokens[p]?.text.toLowerCase() ?? "";
  if (previous === "all" || previous === "distinct") {
    p = previousCode(tokens, p);
    previous = tokens[p]?.text.toLowerCase() ?? "";
  }
  return SET_OPERATORS.has(previous);
}

/** `FROM` inside `a IS [NOT] DISTINCT FROM b` belongs to the expression, not the clause. */
function isDistinctFromOperator(tokens: readonly SqlToken[], index: number): boolean {
  const p = previousCode(tokens, index);
  if (!isKeyword(tokens[p] ?? (tokens[index] as SqlToken), "distinct") || p < 0) return false;
  const before = tokens[previousCode(tokens, p)];
  return before !== undefined && isKeyword(before, "is", "not");
}

/** Index of the first select-list token, past DISTINCT / ALL / DISTINCT ON (...) / TOP n. */
function skipSelectModifiers(tokens: readonly SqlToken[], index: number): number {
  const depth = tokens[index - 1]?.depth ?? 0;
  const skipGroup = (open: number): number => {
    for (let k = open + 1; k < tokens.length; k += 1) {
      const token = tokens[k];
      if (token !== undefined && token.text === ")" && token.depth === depth + 1) return k + 1;
    }
    return tokens.length;
  };
  let j = index;
  for (;;) {
    const token = tokens[j];
    if (token === undefined || token.depth !== depth) return j;
    const lower = token.text.toLowerCase();
    if (lower === "distinct" && isKeyword(tokens[j + 1] ?? token, "on") && tokens[j + 2]?.text === "(") {
      j = skipGroup(j + 2);
    } else if (lower === "top") {
      const amount = tokens[j + 1];
      if (amount?.text === "(") {
        j = skipGroup(j + 1);
      } else if (amount !== undefined && isNumberToken(amount)) {
        j += 2;
      } else {
        return j;
      }
      if (isKeyword(tokens[j] ?? token, "percent")) j += 1;
      if (isKeyword(tokens[j] ?? token, "with") && isKeyword(tokens[j + 1] ?? token, "ties")) j += 2;
    } else if (
      lower === "as" &&
      (isKeyword(tokens[j + 1] ?? token, "struct") || isKeyword(tokens[j + 1] ?? token, "value"))
    ) {
      j += 2;
    } else if (SELECT_MODIFIERS.has(lower)) {
      j += 1;
    } else {
      return j;
    }
  }
}

function isOperator(token: SqlToken | undefined): boolean {
  return token !== undefined && /^[+\-*/%<>=!~|&^:#@]+$/.test(token.text);
}

function isCommentToken(token: SqlToken): boolean {
  return token.kind === Kind.LineComment || token.kind === Kind.BlockComment;
}

function isQuotedIdentifier(token: SqlToken): boolean {
  return token.kind === Kind.Quoted && /^["`[]/.test(token.text);
}

/** `a`, `t.a`, `s.t.a`: names joined by dots. */
function isSimpleColumn(tokens: readonly SqlToken[]): boolean {
  return (
    tokens.length % 2 === 1 &&
    tokens.every((token, i) => (i % 2 === 0 ? isNameToken(token) : token.text === "."))
  );
}

/**
 * Extract alias and aggregate flag from one select-list item.
 *
 * Without `AS`, a trailing bare name is only taken for an implicit alias when
 * the tokens before it clearly end an expression (`f(x) n`, `CASE … END n`,
 * `t.a n`, `1 one`); it is only taken for part of the expression when the
 * token before it clearly expects an operand (an operator or an
 * {@link OPERAND_KEYWORDS} word) or it is a value keyword (`NULL`). Anything
 * else is marked uncertain and keeps its ordinal.
 */
function columnOf(tokens: readonly SqlToken[], start: number, end: number): SelectColumn {
  const visible = tokens.slice(start, end).filter((token) => !isCommentToken(token));
  const first = visible[0];
  const last = visible[visible.length - 1];
  if (first === undefined || last === undefined) {
    return { expressionStart: 0, expressionEnd: 0, alias: undefined, aggregate: false, uncertain: true };
  }
  const secondLast = visible[visible.length - 2];
  const aggregate = AGGREGATE_FUNCTIONS.has(first.text.toLowerCase()) || first.text === "*";
  const column = (alias: string | undefined, expressionEnd: number, uncertain = false): SelectColumn => ({
    expressionStart: first.start,
    expressionEnd,
    alias,
    aggregate,
    uncertain,
  });

  if (secondLast === undefined || isSimpleColumn(visible)) return column(undefined, last.end);
  if (isKeyword(secondLast, "as") && (isNameToken(last) || isQuotedIdentifier(last))) {
    return column(last.text, secondLast.start);
  }
  const lastIsName = isNameToken(last);
  if (!lastIsName && !isQuotedIdentifier(last)) return column(undefined, last.end);

  const lower = last.text.toLowerCase();
  const secondLower = secondLast.text.toLowerCase();
  if (lastIsName && TERMINAL_KEYWORDS.has(lower)) return column(undefined, last.end);
  if (
    secondLast.text === "." ||
    isOperator(secondLast) ||
    (isNameToken(secondLast) && OPERAND_KEYWORDS.has(secondLower))
  ) {
    return column(undefined, last.end);
  }
  if (lastIsName && RESERVED.has(lower)) return column(undefined, last.end, true);

  const prefix = visible.slice(0, -1);
  const endsExpression =
    secondLast.text === ")" ||
    secondLast.text === "]" ||
    isKeyword(secondLast, "end") ||
    isQuotedIdentifier(secondLast) ||
    isSimpleColumn(prefix) ||
    (prefix.length === 1 && (isNumberToken(secondLast) || secondLast.kind === Kind.Quoted));
  return endsExpression ? column(last.text, last.start) : column(undefined, last.end, true);
}

function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Copy a select expression without comments, preserving original spacing. */
function expressionText(sql: string, tokens: readonly SqlToken[], column: SelectColumn): string {
  let result = "";
  let cursor = column.expressionStart;
  for (const token of tokens) {
    if (token.start < column.expressionStart || token.end > column.expressionEnd) continue;
    if (!isCommentToken(token)) continue;
    result += sql.slice(cursor, token.start);
    cursor = token.end;
  }
  result += sql.slice(cursor, column.expressionEnd);
  return flatten(result);
}

/** Lower-cased name with identifier quotes removed, for alias comparisons. */
function bareName(text: string): string {
  return text.replace(/^["`[]|["`\]]$/g, "").toLowerCase();
}

/**
 * Replace `GROUP BY 1, 2` and `ORDER BY 1` ordinals with the corresponding
 * select-list column, but only where the result provably means the same:
 *
 * - GROUP BY copies the column's expression, never its alias: PostgreSQL
 *   resolves a GROUP BY name to an input column first, so
 *   `date_trunc('day', created_at) AS created_at … GROUP BY created_at` would
 *   silently group by the raw column.
 * - ORDER BY uses a unique alias (output names win there) or the expression.
 * - An expression that mentions any output alias, holds a placeholder, is a
 *   bare constant, or (for GROUP BY) is an aggregate keeps its ordinal.
 * - The ORDER BY of a UNION / EXCEPT / INTERSECT sorts the combined result,
 *   which can only be addressed by the first branch's output names; it keeps
 *   its ordinals.
 */
export function replaceOrdinals(sql: string, kinds: Uint8Array): string {
  const tokens = tokenize(sql, kinds);
  const scopes: PendingScope[] = [];
  const replacements: { readonly start: number; readonly end: number; readonly text: string }[] =
    [];

  const newScope = (depth: number, columnStart: number, setOperation: boolean): PendingScope => ({
    depth,
    columns: [],
    phase: "select",
    setOperation,
    columnStart,
    activeClause: undefined,
    groupBy: undefined,
    orderBy: undefined,
    itemStart: 0,
    itemRanges: [],
  });

  const closeClause = (scope: PendingScope, end: number): void => {
    if (scope.activeClause === undefined) return;
    const itemRanges = [...scope.itemRanges, [scope.itemStart, end] as const];
    const clause: Clause = { itemRanges };
    if (scope.activeClause === "group") {
      scope.groupBy = clause;
    } else {
      scope.orderBy = clause;
    }
    scope.activeClause = undefined;
  };

  const resolveOrdinal = (
    scope: PendingScope,
    column: SelectColumn,
    kind: "group" | "order",
  ): string | undefined => {
    if (kind === "order" && scope.setOperation) return undefined;
    if (column.uncertain) return undefined;
    const aliases = scope.columns
      .map((c) => c.alias)
      .filter((alias): alias is string => alias !== undefined)
      .map(bareName);
    if (kind === "order" && column.alias !== undefined) {
      const name = bareName(column.alias);
      return aliases.filter((alias) => alias === name).length === 1 ? column.alias : undefined;
    }
    if (kind === "group" && column.aggregate) return undefined;
    if (kind === "order" && column.aggregate && column.alias === undefined) return undefined;
    const inner = tokens.filter(
      (token) =>
        token.start >= column.expressionStart &&
        token.end <= column.expressionEnd &&
        !isCommentToken(token),
    );
    // ponytail: copying an expression that contains an f-string field or
    // a %-placeholder would duplicate it; keep the ordinal.
    if (inner.some(isPlaceholderToken)) {
      return undefined;
    }
    const names = inner.filter(isNameToken);
    // A bare constant would turn into a literal (`GROUP BY 'x'`) or a different ordinal.
    if (names.length === 0) return undefined;
    if (names.some((token) => aliases.includes(bareName(token.text)))) return undefined;
    return expressionText(sql, tokens, column);
  };

  const finishScope = (scope: PendingScope, endIndex: number): void => {
    closeClause(scope, endIndex);
    for (const clause of [scope.groupBy, scope.orderBy]) {
      if (clause === undefined) continue;
      for (const [start, end] of clause.itemRanges) {
        const itemTokens = tokens.slice(start, end);
        let ordinalToken: SqlToken | undefined;
        const firstItemToken = itemTokens[0];
        if (
          firstItemToken !== undefined &&
          isOrdinalToken(firstItemToken) &&
          itemTokens
            .slice(1)
            .every(
              (token) =>
                ORDINAL_SUFFIXES.has(token.text.toLowerCase()) ||
                isPlaceholderToken(token) ||
                isCommentToken(token),
            )
        ) {
          ordinalToken = firstItemToken;
        }
        if (ordinalToken === undefined) continue;
        const ordinal = Number.parseInt(ordinalToken.text, 10);
        const column = scope.columns[ordinal - 1];
        if (column === undefined) continue;
        const text = resolveOrdinal(scope, column, clause === scope.orderBy ? "order" : "group");
        if (text === undefined || text.length === 0) continue;
        replacements.push({ start: ordinalToken.start, end: ordinalToken.end, text });
      }
    }
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    while (scopes.length > 0) {
      const top = scopes[scopes.length - 1];
      if (top === undefined || token.depth >= top.depth) break;
      finishScope(top, index);
      scopes.pop();
    }
    if (isKeyword(token, "select") && isSelectStart(tokens, index)) {
      const top = scopes[scopes.length - 1];
      if (top !== undefined && token.depth === top.depth) {
        finishScope(top, index);
        scopes.pop();
      }
      scopes.push(
        newScope(token.depth, skipSelectModifiers(tokens, index + 1), followsSetOperator(tokens, index)),
      );
      continue;
    }
    const scope = scopes[scopes.length - 1];
    if (scope === undefined || token.depth !== scope.depth) continue;
    if (scope.phase === "select") {
      if (isKeyword(token, "from") && !isDistinctFromOperator(tokens, index)) {
        if (scope.columnStart < index) {
          scope.columns.push(columnOf(tokens, scope.columnStart, index));
        }
        scope.phase = "from";
      } else if (token.text === ",") {
        if (scope.columnStart < index) {
          scope.columns.push(columnOf(tokens, scope.columnStart, index));
        }
        scope.columnStart = index + 1;
      }
      continue;
    }
    if (token.text === ";") {
      finishScope(scope, index);
      scopes.pop();
      continue;
    }
    if (SET_OPERATORS.has(token.text.toLowerCase())) scope.setOperation = true;
    if (scope.activeClause !== undefined) {
      if (token.text === ",") {
        scope.itemRanges.push([scope.itemStart, index]);
        scope.itemStart = index + 1;
        continue;
      }
      if (
        token.text === ")" ||
        isKeyword(
          token,
          "having",
          "order",
          "limit",
          "offset",
          "qualify",
          "window",
          "fetch",
          "for",
          "union",
          "except",
          "intersect",
          "minus",
          "distribute",
          "with",
        )
      ) {
        closeClause(scope, index);
      }
    }
    if (isKeyword(token, "group") && isKeyword(tokens[index + 1] ?? token, "by")) {
      scope.activeClause = "group";
      scope.itemStart = index + 2;
      scope.itemRanges = [];
    } else if (isKeyword(token, "order") && isKeyword(tokens[index + 1] ?? token, "by")) {
      scope.activeClause = "order";
      scope.itemStart = index + 2;
      scope.itemRanges = [];
    }
  }
  while (scopes.length > 0) {
    const scope = scopes.pop();
    if (scope !== undefined) finishScope(scope, tokens.length);
  }

  let result = sql;
  for (const replacement of [...replacements].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end);
  }
  return result;
}
