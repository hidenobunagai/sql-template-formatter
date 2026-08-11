import { format } from 'sql-formatter';

const DEFAULT_PLACEHOLDER_PATTERNS = [
  '\\$\\{[^}]+\\}',
  '\\{\\{[\\s\\S]*?\\}\\}',
  '\\{[^{}]*\\}',
  '%\\([^)]*\\)s',
  '%s',
];

const paramTypes = {
  custom: DEFAULT_PLACEHOLDER_PATTERNS.map((regex) => ({ regex })),
};

const cases: Array<[string, string]> = [
  ['combined all patterns', 'SELECT {col}, {{ col2 }}, ${c3}, %s, %(n)s FROM ${t} WHERE id = ${id} AND name = \'${nm}\' AND x = %s AND y = %(yy)s;'],
  ['jinja2 with single-brace together', 'SELECT {{ x }}, {y} FROM t WHERE {{ cond }} AND z = {z};'],
  ['? qmark with custom params set', 'SELECT * FROM users WHERE id = ? AND name = %s;'],
  ['no trailing semicolon', 'SELECT * FROM users WHERE id = ${id}'],
  ['leading newline', '\nSELECT * FROM users;'],
];

for (const [name, sql] of cases) {
  try {
    const out = format(sql, { language: 'postgresql', keywordCase: 'upper', tabWidth: 2, paramTypes });
    console.log(`### ${name}`);
    console.log(JSON.stringify(out));
  } catch (err) {
    console.log(`### ${name}`);
    console.log(`THREW: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
  }
  console.log();
}
