import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { supportedDialects } from 'sql-formatter';
import { DEFAULT_PLACEHOLDER_PATTERNS, formatSql, type FormatterConfig } from '../src/format';

const config: FormatterConfig = {
  dialect: 'postgresql',
  placeholderPatterns: [
    '\\$\\{[^}]+\\}',
    '\\{\\{[\\s\\S]*?\\}\\}',
    '\\{[^{}]*\\}',
    '%\\([^)]*\\)s',
    '%s(?![A-Za-z0-9_])',
  ],
  namedPrefixes: [],
  keywordCase: 'upper',
  replaceOrdinals: true,
  commaPosition: 'after',
  keepFunctionsInline: false,
};

describe('formatSql', () => {
  test('keeps ${...} placeholders intact', () => {
    expect(
      formatSql('SELECT * FROM users WHERE id = ${user_id} AND status = ${status};', config)
    ).toBe(
      'SELECT\n  *\nFROM\n  users\nWHERE\n  id = ${user_id}\n  AND status = ${status};'
    );
  });

  test('keeps placeholder inside string literal', () => {
    expect(
      formatSql("SELECT name FROM users WHERE name = '${name}';", config)
    ).toBe(
      "SELECT\n  name\nFROM\n  users\nWHERE\n  name = '${name}';"
    );
  });

  test('keeps placeholder as table name', () => {
    expect(
      formatSql('SELECT * FROM ${table} WHERE id = 1;', config)
    ).toBe(
      'SELECT\n  *\nFROM\n  ${table}\nWHERE\n  id = 1;'
    );
  });

  test('keeps %s tokens', () => {
    expect(
      formatSql('SELECT * FROM users WHERE id = %s AND status = %s;', config)
    ).toBe(
      'SELECT\n  *\nFROM\n  users\nWHERE\n  id = %s\n  AND status = %s;'
    );
  });

  test('does not read %s out of a modulo followed by a name', () => {
    expect(formatSql('SELECT a%size, b % step, %s AS p FROM t;', config)).toBe(
      'SELECT\n  a % size,\n  b % step,\n  %s AS p\nFROM\n  t;'
    );
  });

  test('keeps %(name)s tokens', () => {
    expect(
      formatSql('INSERT INTO log (msg, level) VALUES (%(msg)s, %(level)s);', config)
    ).toBe(
      'INSERT INTO\n  log(msg, level)\nVALUES\n  (%(msg)s, %(level)s);'
    );
  });

  test('keeps jinja2 {{ }} tokens', () => {
    expect(
      formatSql('SELECT {{ column }} FROM t WHERE {{ cond }};', config)
    ).toBe(
      'SELECT\n  {{ column }}\nFROM\n  t\nWHERE\n  {{ cond }};'
    );
  });

  test('keeps single-brace { } tokens', () => {
    expect(
      formatSql('SELECT {col}, {col2} FROM {tablename};', config)
    ).toBe(
      'SELECT\n  {col},\n  {col2}\nFROM\n  {tablename};'
    );
  });

  test('handles multi-line ${...} placeholders', () => {
    expect(
      formatSql('SELECT * FROM t WHERE id = ${\n  foo\n};', config)
    ).toBe(
      'SELECT\n  *\nFROM\n  t\nWHERE\n  id = ${\n  foo\n};'
    );
  });

  test('keeps all patterns combined in one query', () => {
    const sql =
      "SELECT {col}, {{ col2 }}, ${c3}, %s, %(n)s FROM ${t} WHERE id = ${id} AND name = '${nm}' AND x = %s AND y = %(yy)s;";
    const expected =
      "SELECT\n  {col},\n  {{ col2 }},\n  ${c3},\n  %s,\n  %(n)s\nFROM\n  ${t}\nWHERE\n  id = ${id}\n  AND name = '${nm}'\n  AND x = %s\n  AND y = %(yy)s;";
    expect(formatSql(sql, config)).toBe(expected);
  });

  test('does not affect modulo operator', () => {
    expect(
      formatSql('SELECT 5 % 2 AS r, %s AS p;', config)
    ).toBe(
      'SELECT\n  5 % 2 AS r,\n  %s AS p;'
    );
  });

  test('does not touch { } inside string literals (json)', () => {
    expect(
      formatSql("SELECT '{\"a\": 1}'::jsonb;", config)
    ).toBe(
      "SELECT\n  '{\"a\": 1}'::jsonb;"
    );
  });

  test('preserves comment with placeholder', () => {
    expect(
      formatSql('-- ${note}\nSELECT * FROM users;', config)
    ).toBe(
      '-- ${note}\nSELECT\n  *\nFROM\n  users;'
    );
  });

  test('throws on unclosed string literal', () => {
    expect(() => formatSql("SELECT * FROM users WHERE name = 'abc;", config)).toThrow();
  });

  test('rejects settings sql-formatter would mishandle', () => {
    // An unknown keywordCase makes sql-formatter drop every keyword.
    expect(() => formatSql('SELECT a FROM t;', { ...config, keywordCase: 'shout' })).toThrow(
      'invalid keywordCase "shout"'
    );
    expect(() => formatSql('SELECT a FROM t;', { ...config, commaPosition: 'leading' })).toThrow(
      'invalid commaPosition'
    );
    expect(() => formatSql('SELECT a FROM t;', { ...config, dialect: 'nope' })).toThrow('invalid dialect');
    expect(() => formatSql('SELECT a FROM t;', { ...config, namedPrefixes: ['#'] })).toThrow(
      'invalid namedPrefixes entry'
    );
    expect(() =>
      formatSql('SELECT a FROM t;', config, { tabSize: Number.NaN, insertSpaces: true })
    ).toThrow('invalid tab width');
  });

  test('rejects placeholder patterns that are invalid or can match nothing', () => {
    // An empty match never advances sql-formatter's tokenizer: it would loop forever.
    for (const pattern of ['x*', '(?=a)', '@\\w*|']) {
      expect(() => formatSql('SELECT a FROM t;', { ...config, placeholderPatterns: [pattern] })).toThrow(
        'can match an empty string'
      );
    }
    expect(() => formatSql('SELECT a FROM t;', { ...config, placeholderPatterns: ['(unclosed'] })).toThrow(
      'invalid placeholder pattern "(unclosed"'
    );
    expect(formatSql('SELECT @who FROM t;', { ...config, placeholderPatterns: ['@\\w+'] })).toBe(
      'SELECT\n  @who\nFROM\n  t;'
    );
  });

  test('applies keywordCase lower', () => {
    expect(
      formatSql('SELECT * FROM users;', { ...config, keywordCase: 'lower' })
    ).toBe(
      'select\n  *\nfrom\n  users;'
    );
  });

  test('keeps named :prefix when enabled', () => {
    const cfg = { ...config, namedPrefixes: [':'] };
    expect(
      formatSql('SELECT x::text FROM t WHERE id = :id;', cfg)
    ).toBe(
      'SELECT\n  x::text\nFROM\n  t\nWHERE\n  id = :id;'
    );
  });

  test('replaces GROUP BY ordinals with column names', () => {
    expect(
      formatSql('SELECT name, age FROM users GROUP BY 1, 2;', config)
    ).toBe(
      'SELECT\n  name,\n  age\nFROM\n  users\nGROUP BY\n  name,\n  age;'
    );
  });

  test('replaces ORDER BY ordinals keeping direction suffixes', () => {
    expect(
      formatSql('SELECT a AS x, b AS y FROM t ORDER BY 1 DESC, 2 ASC;', config)
    ).toBe(
      'SELECT\n  a AS x,\n  b AS y\nFROM\n  t\nORDER BY\n  x DESC,\n  y ASC;'
    );
  });

  test('keeps out-of-range ordinals untouched', () => {
    expect(
      formatSql('SELECT a FROM t ORDER BY 3;', config)
    ).toBe(
      'SELECT\n  a\nFROM\n  t\nORDER BY\n  3;'
    );
  });

  test('never replaces ordinals after SELECT *', () => {
    expect(
      formatSql('SELECT * FROM t ORDER BY 1, 2;', config)
    ).toBe(
      'SELECT\n  *\nFROM\n  t\nORDER BY\n  1,\n  2;'
    );
  });

  test('keeps ordinals referencing aggregates without alias', () => {
    expect(
      formatSql('SELECT a, COUNT(*) FROM t GROUP BY 1, 2;', config)
    ).toBe(
      'SELECT\n  a,\n  COUNT(*)\nFROM\n  t\nGROUP BY\n  a,\n  2;'
    );
  });

  test('keeps ordinal when column expression contains a placeholder', () => {
    expect(
      formatSql('SELECT ${col}, name FROM t GROUP BY 1, 2;', config)
    ).toBe(
      'SELECT\n  ${col},\n  name\nFROM\n  t\nGROUP BY\n  1,\n  name;'
    );
    expect(
      formatSql('SELECT %s, name FROM t GROUP BY 1, 2;', config)
    ).toBe(
      'SELECT\n  %s,\n  name\nFROM\n  t\nGROUP BY\n  1,\n  name;'
    );
  });

  test('keeps ordinals when replaceOrdinals is disabled', () => {
    const cfg = { ...config, replaceOrdinals: false };
    expect(
      formatSql('SELECT name, age FROM users GROUP BY 1, 2;', cfg)
    ).toBe(
      'SELECT\n  name,\n  age\nFROM\n  users\nGROUP BY\n  1,\n  2;'
    );
  });

  test('does not mistake a :: cast for a column alias', () => {
    expect(formatSql('SELECT created_at::date, count(*) FROM t GROUP BY 1;', config)).toBe(
      'SELECT\n  created_at::date,\n  count(*)\nFROM\n  t\nGROUP BY\n  created_at::date;'
    );
  });

  test('copies the expression, not the alias, into GROUP BY', () => {
    expect(formatSql('SELECT upper(name) AS n, count(*) FROM t GROUP BY 1;', config)).toBe(
      'SELECT\n  upper(name) AS n,\n  count(*)\nFROM\n  t\nGROUP BY\n  upper(name);'
    );
  });

  test('keeps a GROUP BY ordinal whose expression mentions an output alias', () => {
    // GROUP BY created_at would group by the raw input column in PostgreSQL.
    expect(
      formatSql("SELECT date_trunc('day', created_at) AS created_at, count(*) FROM t GROUP BY 1;", config)
    ).toBe(
      "SELECT\n  date_trunc('day', created_at) AS created_at,\n  count(*)\nFROM\n  t\nGROUP BY\n  1;"
    );
  });

  test('keeps ORDER BY ordinals of a set operation', () => {
    expect(formatSql('SELECT a FROM t UNION ALL SELECT b FROM u ORDER BY 1;', config)).toBe(
      'SELECT\n  a\nFROM\n  t\nUNION ALL\nSELECT\n  b\nFROM\n  u\nORDER BY\n  1;'
    );
    expect(formatSql('SELECT a FROM t UNION (SELECT b FROM u) ORDER BY 1;', config)).toContain(
      'ORDER BY\n  1;'
    );
  });

  test('skips DISTINCT when copying the first column', () => {
    expect(formatSql('SELECT DISTINCT upper(a), b FROM t ORDER BY 1, 2;', config)).toBe(
      'SELECT DISTINCT\n  upper(a),\n  b\nFROM\n  t\nORDER BY\n  upper(a),\n  b;'
    );
  });

  test('never treats an operand keyword as an implicit alias', () => {
    expect(formatSql('SELECT a IS NULL, b LIKE c FROM t ORDER BY 1, 2;', config)).toBe(
      'SELECT\n  a IS NULL,\n  b LIKE c\nFROM\n  t\nORDER BY\n  a IS NULL,\n  b LIKE c;'
    );
  });

  test('keeps ordinals that point at constants', () => {
    expect(formatSql("SELECT 'x' AS k, 5, a FROM t GROUP BY 1, 2, 3;", config)).toBe(
      "SELECT\n  'x' AS k,\n  5,\n  a\nFROM\n  t\nGROUP BY\n  1,\n  2,\n  a;"
    );
  });

  test('treats only plain integers as ordinals', () => {
    expect(formatSql('SELECT a, b FROM t ORDER BY 1.5;', config)).toContain('ORDER BY\n  1.5;');
    expect(formatSql('SELECT a, count(*) FROM t GROUP BY 1e0;', config)).toContain('GROUP BY\n  1e0;');
  });

  test('keeps operands of IS DISTINCT FROM, AT TIME ZONE, and OVER in the expression', () => {
    expect(formatSql('SELECT a IS DISTINCT FROM b, c FROM t ORDER BY 1, 2;', config)).toContain(
      'ORDER BY\n  a IS DISTINCT FROM b,\n  c;'
    );
    expect(formatSql('SELECT a IS NOT DISTINCT FROM b AS same, c FROM t ORDER BY 1;', config)).toContain(
      'ORDER BY\n  same;'
    );
    expect(formatSql('SELECT ts AT TIME ZONE zone_name, c FROM t ORDER BY 1;', config)).toContain(
      'ORDER BY\n  ts AT TIME ZONE zone_name;'
    );
    expect(
      formatSql('SELECT sum(x) OVER w, c FROM t WINDOW w AS (ORDER BY c) ORDER BY 1;', config)
    ).toMatch(/ORDER BY\n  1;$/);
  });

  test('keeps an ordinal whose trailing name might be an alias or a keyword', () => {
    expect(formatSql('SELECT now() - INTERVAL 1 DAY, c FROM t ORDER BY 1;', config)).toContain(
      'ORDER BY\n  1;'
    );
    expect(formatSql('SELECT x::double precision, c FROM t ORDER BY 1;', config)).toContain(
      'ORDER BY\n  1;'
    );
    expect(
      formatSql('SELECT a ISNULL, f(y) n, t.a b, CASE WHEN a THEN 1 END k, 1 one FROM t ORDER BY 1, 2, 3, 4, 5;', config)
    ).toContain('ORDER BY\n  a ISNULL,\n  n,\n  b,\n  k,\n  one;');
  });

  test('sees a set operator through comments before the SELECT', () => {
    expect(formatSql('SELECT a FROM t UNION /* note */ SELECT b FROM u ORDER BY 1;', config)).toContain(
      'ORDER BY\n  1;'
    );
    expect(
      formatSql('SELECT a FROM t UNION -- note\nALL /* x */ SELECT b FROM u ORDER BY 1;', config)
    ).toContain('ORDER BY\n  1;');
  });

  test('keeps an ORDER BY ordinal whose alias is not unique', () => {
    expect(formatSql('SELECT a AS n, b AS n FROM t ORDER BY 1;', config)).toContain('ORDER BY\n  1;');
  });

  test('keeps the trailing newline when the input has one', () => {
    expect(formatSql('select id from users;\n', config)).toBe(
      'SELECT\n  id\nFROM\n  users;\n'
    );
  });

  test('collapses extra trailing newlines to one', () => {
    expect(formatSql('select id from users;\n\n\n', config)).toBe(
      'SELECT\n  id\nFROM\n  users;\n'
    );
  });

  test('does not add a trailing newline when the input has none', () => {
    expect(formatSql('select id from users;', config)).toBe(
      'SELECT\n  id\nFROM\n  users;'
    );
  });

  test('is idempotent for input with a trailing newline', () => {
    const once = formatSql('select id, name from users where id = ${id};\n', config);
    expect(formatSql(once, config)).toBe(once);
  });

  test('keeps the trailing newline for a placeholder-only addition', () => {
    expect(formatSql('delete from t where id in (${ids});\n', config)).toBe(
      'DELETE FROM t\nWHERE\n  id IN (${ids});\n'
    );
  });

  test('keeps wrapping commas at the end of the line by default', () => {
    expect(formatSql('SELECT id, name FROM users;', config)).toBe(
      'SELECT\n  id,\n  name\nFROM\n  users;'
    );
  });

  test('moves wrapping commas to the next line when commaPosition is before', () => {
    const cfg = { ...config, commaPosition: 'before' };
    expect(formatSql('SELECT id, name FROM users WHERE id = ${uid};', cfg)).toBe(
      'SELECT\n  id\n  , name\nFROM\n  users\nWHERE\n  id = ${uid};'
    );
  });

  test('keeps trailing comments with their item when commaPosition is before', () => {
    const cfg = { ...config, commaPosition: 'before' };
    expect(formatSql('SELECT order_id, -- c\norder_date, -- c\namount FROM t;', cfg)).toBe(
      'SELECT\n  order_id -- c\n  , order_date -- c\n  , amount\nFROM\n  t;'
    );
  });

  test('leaves a comma inside a multi-line string literal alone', () => {
    const cfg = { ...config, commaPosition: 'before' };
    expect(formatSql("SELECT 'keep,\nme' AS x, y FROM t;", cfg)).toBe(
      "SELECT\n  'keep,\nme' AS x\n  , y\nFROM\n  t;"
    );
  });

  test('leaves a dollar-quoted body alone when commaPosition is before', () => {
    const cfg = { ...config, commaPosition: 'before' };
    expect(formatSql('CREATE FUNCTION f() RETURNS int AS $$\nSELECT a,\n  b\nFROM t\n$$ LANGUAGE sql;\n', cfg)).toBe(
      'CREATE FUNCTION f () RETURNS int AS $$\nSELECT a,\n  b\nFROM t\n$$ LANGUAGE sql;\n'
    );
  });

  test('is idempotent when commaPosition is before', () => {
    const cfg = { ...config, commaPosition: 'before' };
    const once = formatSql('select id, name from users where id = ${id};\n', cfg);
    expect(formatSql(once, cfg)).toBe(once);
  });

  test('reads a PostgreSQL backslash as a literal character, not an escape', () => {
    const cfg = { ...config, commaPosition: 'before' };
    expect(formatSql("SELECT 'C:\\' AS p, 'hello,\nworld' AS r, s FROM t;", cfg)).toBe(
      "SELECT\n  'C:\\' AS p\n  , 'hello,\nworld' AS r\n  , s\nFROM\n  t;"
    );
    const inline = { ...config, keepFunctionsInline: true };
    expect(formatSql("SELECT concat('C:\\', 'b\nc', d) FROM t;", inline)).toBe(
      "SELECT\n  concat('C:\\', 'b\nc', d)\nFROM\n  t;"
    );
  });

  test('honours backslash escapes where the dialect has them', () => {
    const cfg = { ...config, dialect: 'mysql', commaPosition: 'before' };
    expect(formatSql("SELECT 'it\\'s', 'a,\nb' AS x, y FROM t;", cfg)).toBe(
      "SELECT\n  'it\\'s'\n  , 'a,\nb' AS x\n  , y\nFROM\n  t;"
    );
  });

  test('treats # as a comment only in dialects that have # comments', () => {
    const cfg = { ...config, commaPosition: 'before' };
    expect(formatSql("SELECT data #>> '{a,b}' AS x, y FROM t;", cfg)).toBe(
      "SELECT\n  data #>> '{a,b}' AS x\n  , y\nFROM\n  t;"
    );
    expect(formatSql('SELECT a, # note\n b FROM t;', { ...cfg, dialect: 'mysql' })).toBe(
      'SELECT\n  a # note\n  , b\nFROM\n  t;'
    );
  });

  test('never moves a comma inside a placeholder', () => {
    const cfg = { ...config, commaPosition: 'before' };
    expect(formatSql('SELECT {a,\nb}, c FROM t;', cfg)).toBe('SELECT\n  {a,\nb}\n  , c\nFROM\n  t;');
  });

  test('puts a moved comma on the item, not on a comment line in between', () => {
    const cfg = { ...config, commaPosition: 'before' };
    expect(formatSql('SELECT a,\n-- note\nb FROM t;', cfg)).toBe(
      'SELECT\n  a\n  -- note\n  , b\nFROM\n  t;'
    );
  });

  test('never replaces an ordinal inside a multi-line string literal', () => {
    expect(formatSql("SELECT a FROM t WHERE b = 'x\ngroup by 1';", config)).toBe(
      "SELECT\n  a\nFROM\n  t\nWHERE\n  b = 'x\ngroup by 1';"
    );
  });

  test('breaks long function arguments by default', () => {
    expect(
      formatSql(
        'SELECT COALESCE(first_name, middle_name, last_name, display_name, email) AS name FROM users;',
        config
      )
    ).toBe(
      'SELECT\n  COALESCE(\n    first_name,\n    middle_name,\n    last_name,\n    display_name,\n    email\n  ) AS name\nFROM\n  users;'
    );
  });

  test('keeps long function arguments on one line when keepFunctionsInline', () => {
    const cfg = { ...config, keepFunctionsInline: true };
    expect(
      formatSql(
        'SELECT COALESCE(first_name, middle_name, last_name, display_name, email) AS name FROM users;',
        cfg
      )
    ).toBe(
      'SELECT\n  COALESCE(first_name, middle_name, last_name, display_name, email) AS name\nFROM\n  users;'
    );
  });

  test('keeps CASE inside a function on one line when keepFunctionsInline', () => {
    const cfg = { ...config, keepFunctionsInline: true };
    expect(formatSql('SELECT COUNT(CASE WHEN a THEN 1 ELSE 0 END) AS n FROM t;', cfg)).toBe(
      'SELECT\n  COUNT(CASE WHEN a THEN 1 ELSE 0 END) AS n\nFROM\n  t;'
    );
  });

  test('keeps nested calls on one line when keepFunctionsInline', () => {
    const cfg = { ...config, keepFunctionsInline: true };
    expect(
      formatSql(
        'SELECT MAX(LEAST(COALESCE(discount_amount, standard_discount), price_cap)) AS capped FROM orders;',
        cfg
      )
    ).toBe(
      'SELECT\n  MAX(LEAST(COALESCE(discount_amount, standard_discount), price_cap)) AS capped\nFROM\n  orders;'
    );
  });

  test('never removes newlines inside strings or comments when keepFunctionsInline', () => {
    const cfg = { ...config, keepFunctionsInline: true };
    expect(formatSql('SELECT SUM(a -- note\n) AS x FROM t;', cfg)).toBe(
      'SELECT\n  SUM(a -- note\n  ) AS x\nFROM\n  t;'
    );
    expect(formatSql("SELECT SUM('line1,\nline2') AS x FROM t;", cfg)).toBe(
      "SELECT\n  SUM('line1,\nline2') AS x\nFROM\n  t;"
    );
  });

  test('keeps CTE bodies and subqueries multi-line when keepFunctionsInline', () => {
    const cfg = { ...config, keepFunctionsInline: true };
    expect(
      formatSql(
        'WITH x AS (SELECT a, COALESCE(b, c, d, e, f, g, h) AS v FROM t) SELECT * FROM (SELECT a FROM x) s WHERE EXISTS (SELECT 1 FROM y) AND a IN (SELECT a FROM z);',
        cfg
      )
    ).toBe(
      [
        'WITH',
        '  x AS (',
        '    SELECT',
        '      a,',
        '      COALESCE(b, c, d, e, f, g, h) AS v',
        '    FROM',
        '      t',
        '  )',
        'SELECT',
        '  *',
        'FROM',
        '  (',
        '    SELECT',
        '      a',
        '    FROM',
        '      x',
        '  ) s',
        'WHERE',
        '  EXISTS (',
        '    SELECT',
        '      1',
        '    FROM',
        '      y',
        '  )',
        '  AND a IN (',
        '    SELECT',
        '      a',
        '    FROM',
        '      z',
        '  );',
      ].join('\n')
    );
  });

  test('is idempotent when keepFunctionsInline', () => {
    const cfg = { ...config, keepFunctionsInline: true };
    const once = formatSql('select count(case when a then 1 else 0 end) as n from t;\n', cfg);
    expect(formatSql(once, cfg)).toBe(once);
  });
});

describe('package.json settings', () => {
  const pkg = JSON.parse(readFileSync(path.join(import.meta.dir, '..', 'package.json'), 'utf8'));
  const props = pkg.contributes.configuration.properties;

  test('offers exactly the dialects sql-formatter supports', () => {
    expect([...props['sqlTemplateFormatter.dialect'].enum].sort()).toEqual([...supportedDialects].sort());
  });

  test('ships the same default placeholder patterns as the core', () => {
    expect(props['sqlTemplateFormatter.placeholderPatterns'].default).toEqual(DEFAULT_PLACEHOLDER_PATTERNS);
  });

  test('every setting can be overridden per language and per folder', () => {
    for (const [name, prop] of Object.entries(props)) {
      expect([name, (prop as { scope?: string }).scope]).toEqual([name, 'language-overridable']);
    }
  });
});
