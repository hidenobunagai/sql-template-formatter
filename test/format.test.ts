import { describe, expect, test } from 'bun:test';
import { formatSql, type FormatterConfig } from '../src/format';

const config: FormatterConfig = {
  dialect: 'postgresql',
  placeholderPatterns: [
    '\\$\\{[^}]+\\}',
    '\\{\\{[\\s\\S]*?\\}\\}',
    '\\{[^{}]*\\}',
    '%\\([^)]*\\)s',
    '%s',
  ],
  namedPrefixes: [],
  keywordCase: 'upper',
  replaceOrdinals: true,
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
});
