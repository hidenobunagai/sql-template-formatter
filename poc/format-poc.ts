import { format } from 'sql-formatter';

const paramTypes = {
  custom: [
    { regex: /\$\{[^}]+\}/ },
    { regex: /\{\{[\s\S]*?\}\}/ },
    { regex: /\{[^{}]*\}/ },
    { regex: /%\([^)]*\)s/ },
  ],
  positional: ['%s'],
};

const cases: Array<[string, string]> = [
  ['placeholders in WHERE', 'SELECT * FROM users WHERE id = ${user_id} AND status = ${status};'],
  ['placeholder in string literal', "SELECT name FROM users WHERE name = '${name}';"],
  ['placeholder as table', 'SELECT * FROM ${table} WHERE id = 1;'],
  ['python %s positional', 'SELECT * FROM users WHERE id = %s AND status = %s;'],
  ['python %(name)s', 'INSERT INTO log (msg, level) VALUES (%(msg)s, %(level)s);'],
  ['jinja2 braces', 'SELECT {{ column }} FROM t WHERE {{ cond }};'],
  ['single brace', 'SELECT {col}, {col2} FROM {tablename};'],
  ['multi-line placeholder', 'SELECT * FROM t WHERE id = ${\n  foo\n};'],
  ['modulo operator', 'SELECT 5 % 2 AS r;'],
  ['json literal in string', "SELECT '{\"a\": 1}'::jsonb;"],
  ['comment with placeholder', '-- ${note}\nSELECT * FROM users;'],
  ['invalid sql should throw', 'SELECT FROM WHERE;'],
  ['named prefix : colon', 'SELECT * FROM users WHERE id = :id;'],
  ['cast with named prefix', 'SELECT x::text FROM t;'],
];

for (const [name, sql] of cases) {
  try {
    const out = format(sql, {
      language: 'postgresql',
      keywordCase: 'upper',
      tabWidth: 2,
      paramTypes,
    });
    console.log(`=== ${name} ===`);
    console.log(JSON.stringify(out));
  } catch (err) {
    console.log(`=== ${name} ===`);
    console.log(`THREW: ${err instanceof Error ? err.message : err}`);
  }
  console.log();
}
