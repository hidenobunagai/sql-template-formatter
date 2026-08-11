import { format } from 'sql-formatter';

const variants: Array<[string, object]> = [
  ['docs exact: String.raw string regex {\\w+}', {
    paramTypes: { custom: [{ regex: String.raw`\{\\w+\}` }] },
  }],
  ['string regex "\\$\\{[^}]+\\}"', {
    paramTypes: { custom: [{ regex: '\\$\\{[^}]+\\}' }] },
  }],
  ['RegExp literal /\\$\\{[^}]+\\}/', {
    paramTypes: { custom: [{ regex: /\$\{[^}]+}/ }] },
  }],
  ['RegExp literal + key fn', {
    paramTypes: { custom: [{ regex: /\$\{[^}]+}/, key: (t: string) => t }] },
  }],
  ['combined: docs {\\w+} on {col}', {
    paramTypes: { custom: [{ regex: String.raw`\{\\w+\}` }] },
  }],
  ['positional string array only ["?"]', {
    paramTypes: { positional: ['?'] },
  }],
  ['positional boolean true', {
    paramTypes: { positional: true },
  }],
];

const sqls: Array<[string, string]> = [
  ['${} in where', 'SELECT * FROM users WHERE id = ${user_id} AND status = ${status};'],
  ['{} single', 'SELECT {col1}, {col2} FROM {tablename};'],
  ['? qmark', 'SELECT * FROM users WHERE id = ? AND status = ?;'],
];

for (const [vname, opts] of variants) {
  console.log(`### ${vname}`);
  for (const [sname, sql] of sqls) {
    try {
      const out = format(sql, { language: 'postgresql', keywordCase: 'upper', tabWidth: 2, ...opts });
      console.log(`  [${sname}] => ${JSON.stringify(out)}`);
    } catch (err) {
      console.log(`  [${sname}] THREW: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
    }
  }
}
