import { format } from 'sql-formatter';

const cases: Array<[string, string, object, string?]> = [
  ['{col} single brace, postgresql', 'SELECT {col1}, {col2} FROM {tablename};', { paramTypes: { custom: [{ regex: '\\{[^{}]*\\}' }] } }, 'postgresql'],
  ['{col} single brace, default dialect', 'SELECT {col1}, {col2} FROM {tablename};', { paramTypes: { custom: [{ regex: '\\{[^{}]*\\}' }] } }, undefined],
  ['{{ jinja2 }} postgresql', 'SELECT {{ column }} FROM t WHERE {{ cond }};', { paramTypes: { custom: [{ regex: '\\{\\{[\\s\\S]*?\\}\\}' }] } }, 'postgresql'],
  ['${} in FROM postgresql', 'SELECT * FROM ${table} WHERE id = 1;', { paramTypes: { custom: [{ regex: '\\$\\{[^}]+\\}' }] } }, 'postgresql'],
  ['${} multi-line postgresql', 'SELECT * FROM t WHERE id = ${\n  foo\n};', { paramTypes: { custom: [{ regex: '\\$\\{[^}]+\\}' }] } }, 'postgresql'],
  ['%(name)s custom regex', 'INSERT INTO log (msg) VALUES (%(msg)s);', { paramTypes: { custom: [{ regex: '%\\([^)]*\\)s' }] } }, 'postgresql'],
  ['%s custom regex exact', 'SELECT * FROM users WHERE id = %s;', { paramTypes: { custom: [{ regex: '%s' }] } }, 'postgresql'],
  ['%s positional [%]', 'SELECT * FROM users WHERE id = %s;', { paramTypes: { positional: ['%'] } }, 'postgresql'],
  ['%s positional [%s]', 'SELECT * FROM users WHERE id = %s;', { paramTypes: { positional: ['%s'] } }, 'postgresql'],
  ['%s named [%]', 'SELECT * FROM users WHERE id = %s;', { paramTypes: { named: ['%'] } }, 'postgresql'],
  ['modulo with custom %s', 'SELECT 5 % 2 AS r, %s AS p;', { paramTypes: { custom: [{ regex: '%s' }] } }, 'postgresql'],
  ['cast :: with named [:]', 'SELECT x::text FROM t WHERE id = :id;', { paramTypes: { named: [':'] } }, 'postgresql'],
  ['colon in strings with named [:]', "SELECT ':not_a_param' AS s;", { paramTypes: { named: [':'] } }, 'postgresql'],
];

for (const [name, sql, opts, lang] of cases) {
  try {
    const out = format(sql, { language: lang as 'postgresql' | undefined, keywordCase: 'upper', tabWidth: 2, ...opts });
    console.log(`### ${name}`);
    console.log(JSON.stringify(out));
  } catch (err) {
    console.log(`### ${name}`);
    console.log(`THREW: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
  }
  console.log();
}
