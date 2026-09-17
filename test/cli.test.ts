import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const CLI = path.join(import.meta.dir, '..', 'out', 'cli.js');
const INPUT = 'select id, name from users where tenant = ${tid} and flag = %s group by 1, 2;\n';
const FORMATTED = [
  'SELECT',
  '  id,',
  '  name',
  'FROM',
  '  users',
  'WHERE',
  '  tenant = ${tid}',
  '  AND flag = %s',
  'GROUP BY',
  '  id,',
  '  name;',
].join('\n');
const KEPT_ORDINALS = FORMATTED.replace('GROUP BY\n  id,\n  name;', 'GROUP BY\n  1,\n  2;');

function run(args: string[], cwd: string, input?: string) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', input });
}

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'sql-template-formatter-cli-'));
  writeFileSync(path.join(dir, 'unformatted.sql'), INPUT);
  writeFileSync(path.join(dir, 'formatted.sql'), FORMATTED);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('sql-template-formatter CLI', () => {
  test('formats a file to stdout', () => {
    const result = run(['unformatted.sql'], dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(FORMATTED);
  });

  test('reads stdin when no file is given', () => {
    const result = run([], dir, INPUT);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(FORMATTED);
  });

  test('--write rewrites in place and is idempotent', () => {
    const target = path.join(dir, 'write.sql');
    copyFileSync(path.join(dir, 'unformatted.sql'), target);

    expect(run(['--write', 'write.sql'], dir).status).toBe(0);
    expect(readFileSync(target, 'utf8')).toBe(FORMATTED);

    expect(run(['-w', 'write.sql'], dir).status).toBe(0);
    expect(readFileSync(target, 'utf8')).toBe(FORMATTED);
  });

  test('--check reports unformatted files with exit code 1', () => {
    const bad = run(['--check', 'unformatted.sql'], dir);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('unformatted.sql is not formatted');

    const good = run(['--check', 'formatted.sql'], dir);
    expect(good.status).toBe(0);
    expect(good.stdout).toBe('');
  });

  test('--no-ordinals keeps GROUP BY ordinals', () => {
    const result = run(['--no-ordinals', 'unformatted.sql'], dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(KEPT_ORDINALS);
  });

  test('honors .sql-formatter.json found in a parent directory', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sql-template-formatter-config-'));
    try {
      mkdirSync(path.join(root, 'nested'));
      writeFileSync(
        path.join(root, '.sql-formatter.json'),
        JSON.stringify({ language: 'mysql', keywordCase: 'lower', replaceOrdinals: false })
      );
      writeFileSync(path.join(root, 'nested', 'a.sql'), INPUT);
      const result = run(['a.sql'], path.join(root, 'nested'));
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(KEPT_ORDINALS.toLowerCase());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('reports an unknown dialect with exit code 2', () => {
    const result = run(['--dialect', 'nope', 'unformatted.sql'], dir);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('sql-template-formatter: unformatted.sql:');
  });

  test('--write without a file fails', () => {
    const result = run(['--write'], dir, INPUT);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--write needs at least one file');
  });

  test('--version prints the package version', () => {
    const pkg = JSON.parse(
      readFileSync(path.join(import.meta.dir, '..', 'package.json'), 'utf8')
    ) as { version: string };
    const result = run(['--version'], dir);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
  });
});
