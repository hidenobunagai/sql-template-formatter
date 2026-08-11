# SQL Template Formatter - 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Python プロジェクトの .sql ファイルに含まれるテンプレートプレースホルダー (`${var}`, `{var}`, `{{ var }}`, `%s`, `%(name)s`) を壊さずに SQL フォーマットできる VSCode 拡張機能を新規作成する。

**Architecture:** 既存拡張 (kufii/vscode-sql-formatter) のフォークではなく、最小の TypeScript 拡張を新規実装する。マスク方式は採らず、`sql-formatter` v15+ の `paramTypes` 機能 (custom regex / positional tokens / named prefixes) を settings から組み立てて渡すだけの薄いラッパーにする。全文フォーマット + 選択範囲フォーマットの両 provider を sql 言語に登録し、VSCode 標準の Shift+Alt+F / formatOnSave をそのまま使う。

**Tech Stack:** TypeScript, VSCode Extension API, `sql-formatter` (v15+), bun (パッケージ管理・テスト), `@vscode/vsce` (パッケージング)

**検証済みの事実 (Phase 0 PoC で実測):**
- `paramTypes.custom` に `\$\{[^}]+}`, `\{\{[\s\S]*?\}\}`, `\{[^{}]*\}`, `%\([^)]*\)s` を順に渡すと、全パターンがそのまま保持され整形される
- `positional: ['%s']` で `%s` は保持される。`5 % 2` の剰余演算子は影響を受けない
- `'${name}'` のように文字列リテラル内にある場合、レキサーが文字列を先に消費するため安全
- 複数行にまたがる `${...}` は `[^}]` (否定クラス) が改行にマッチするため問題なし
- 末尾セミコロンは `;` の後に改行しない形式で保持される
- 無効な正規表現 / 構文エラーは `format()` が throw する → try/catch で警告表示

---

### Task 1: プロジェクト初期化 (gitignore, bunfig, LICENSE)

**Files:**
- Create: `.gitignore`
- Create: `bunfig.toml`
- Create: `LICENSE`

- [ ] **Step 1: `.gitignore` を作成**

```gitignore
node_modules/
out/
*.vsix
.headroom/
```

- [ ] **Step 2: `bunfig.toml` を作成** (供給チェーン対策: 依存の minimumReleaseAge 7日)

```toml
[install]
minimumReleaseAge = 604800 # 7 days (seconds)
minimumReleaseAgeExcludes = ["typescript", "@types/node", "@types/vscode"]
```

- [ ] **Step 3: `LICENSE` を作成** (Marketplace 公開に必須)

```text
MIT License

Copyright (c) 2026 hidenobunagai

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore bunfig.toml LICENSE
git commit -m "chore: プロジェクト初期設定 (gitignore, bunfig, MIT LICENSE)"
```

### Task 2: 依存インストールと PoC 検証スクリプト

**Files:**
- Create: `poc/format-poc.ts`
- Modify: `package.json` (dependencies は既に記述済み)

- [ ] **Step 1: 依存をインストール** (`--ignore-scripts` で lifecycle 実行を抑制)

```bash
bun install --ignore-scripts
```

- [ ] **Step 2: PoC スクリプトを作成** — 全パターンの実測出力を確認する

```ts
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
    console.log(out);
  } catch (err) {
    console.log(`=== ${name} ===`);
    console.log(`THREW: ${err instanceof Error ? err.message : err}`);
  }
  console.log();
}
```

- [ ] **Step 3: PoC を実行して実測出力を確認**

```bash
bun run poc/format-poc.ts
```

Expected: 全ケースが出力される。`invalid sql should throw` のみ THREW になる。出力をメモしておく (Task 3 のテスト期待値に使う)。実測で `===` 区切り以降の出力が計画の Task 3 期待値と一致しない場合、実測値を正とする。

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock poc/format-poc.ts
git commit -m "feat: sql-formatter 依存導入と paramTypes 方式の PoC 検証"
```

### Task 3: コア実装 `src/format.ts` (TDD)

**Files:**
- Create: `src/format.ts`
- Create: `test/format.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, expect, test } from 'bun:test';
import { formatSql, type FormatterConfig } from '../src/format';

const config: FormatterConfig = {
  dialect: 'postgresql',
  placeholderPatterns: [
    '\\$\\{[^}]+\\}',
    '\\{\\{[\\s\\S]*?\\}\\}',
    '\\{[^{}]*\\}',
    '%\\([^)]*\\)s',
  ],
  positionalTokens: ['%s'],
  namedPrefixes: [],
  keywordCase: 'upper',
};

describe('formatSql', () => {
  test('keeps ${...} placeholders intact', () => {
    expect(formatSql('SELECT * FROM users WHERE id = ${user_id} AND status = ${status};', config)).toBe(`SELECT
  *
FROM
  users
WHERE
  id = ${'${user_id}'}
  AND status = ${'${status}'};
`);
  });

  test('keeps placeholder inside string literal', () => {
    expect(formatSql("SELECT name FROM users WHERE name = '${name}';", config)).toBe(`SELECT
  name
FROM
  users
WHERE
  name = '${'${name}'}';
`);
  });

  test('keeps placeholder as table name', () => {
    expect(formatSql('SELECT * FROM ${table} WHERE id = 1;', config)).toBe(`SELECT
  *
FROM
  ${'${table}'}
WHERE
  id = 1;
`);
  });

  test('keeps %s positional tokens', () => {
    expect(formatSql('SELECT * FROM users WHERE id = %s AND status = %s;', config)).toBe(`SELECT
  *
FROM
  users
WHERE
  id = %s
  AND status = %s;
`);
  });

  test('keeps %(name)s tokens', () => {
    expect(formatSql('INSERT INTO log (msg, level) VALUES (%(msg)s, %(level)s);', config)).toBe(`INSERT INTO
  log (msg, level)
VALUES
  (%(msg)s, %(level)s);
`);
  });

  test('keeps jinja2 {{ }} tokens', () => {
    expect(formatSql('SELECT {{ column }} FROM t WHERE {{ cond }};', config)).toBe(`SELECT
  {{ column }}
FROM
  t
WHERE
  {{ cond }};
`);
  });

  test('keeps single-brace { } tokens', () => {
    expect(formatSql('SELECT {col}, {col2} FROM {tablename};', config)).toBe(`SELECT
  {col},
  {col2}
FROM
  {tablename};
`);
  });

  test('handles multi-line ${...} placeholders', () => {
    expect(formatSql('SELECT * FROM t WHERE id = ${\n  foo\n};', config)).toBe(`SELECT
  *
FROM
  t
WHERE
  id = ${
  foo
};
`);
  });

  test('does not affect modulo operator', () => {
    expect(formatSql('SELECT 5 % 2 AS r;', config)).toBe(`SELECT
  5 % 2 AS r;
`);
  });

  test('does not touch { } inside string literals (json)', () => {
    expect(formatSql("SELECT '{\"a\": 1}'::jsonb;", config)).toBe(`SELECT
  '{\"a\": 1}'::jsonb;
`);
  });

  test('preserves comment with placeholder', () => {
    expect(formatSql('-- ${note}\nSELECT * FROM users;', config)).toBe(`-- ${'${note}'}
SELECT
  *
FROM
  users;
`);
  });

  test('throws on invalid SQL', () => {
    expect(() => formatSql('SELECT FROM WHERE;', config)).toThrow();
  });

  test('applies keywordCase lower', () => {
    expect(
      formatSql('SELECT * FROM users;', { ...config, keywordCase: 'lower' })
    ).toBe(`select
  *
from
  users;
`);
  });
});
```

注意: 上の期待値は PoC 実測値を前提としている。Task 2 Step 3 の実測出力と食い違う場合は**実測値を期待値に反映**してから進めること。

- [ ] **Step 2: テストが失敗することを確認**

```bash
bun test
```

Expected: FAIL (`Cannot find module '../src/format'` 相当)

- [ ] **Step 3: 最小実装を書く**

```ts
import { format, type FormatOptions } from 'sql-formatter';

export type Dialect = NonNullable<FormatOptions['language']>;
export type KeywordCase = NonNullable<FormatOptions['keywordCase']>;

export interface FormatterConfig {
  dialect: string;
  placeholderPatterns: string[];
  positionalTokens: string[];
  namedPrefixes: string[];
  keywordCase: string;
}

export const DEFAULT_PLACEHOLDER_PATTERNS = [
  '\\$\\{[^}]+\\}',
  '\\{\\{[\\s\\S]*?\\}\\}',
  '\\{[^{}]*\\}',
  '%\\([^)]*\\)s',
];

export interface EditorOptions {
  tabSize: number;
  insertSpaces: boolean;
}

export function formatSql(
  sql: string,
  config: FormatterConfig,
  editorOptions?: EditorOptions
): string {
  const paramTypes: FormatOptions['paramTypes'] = {};
  if (config.placeholderPatterns.length > 0) {
    paramTypes.custom = config.placeholderPatterns.map((p) => ({ regex: new RegExp(p) }));
  }
  if (config.positionalTokens.length > 0) {
    paramTypes.positional = config.positionalTokens;
  }
  if (config.namedPrefixes.length > 0) {
    paramTypes.named = config.namedPrefixes;
  }
  return format(sql, {
    language: config.dialect as Dialect,
    keywordCase: config.keywordCase as KeywordCase,
    tabWidth: editorOptions?.tabSize ?? 2,
    useTabs: editorOptions ? !editorOptions.insertSpaces : false,
    paramTypes,
  });
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
bun test
```

Expected: 13 tests all PASS

- [ ] **Step 5: Commit**

```bash
git add src/format.ts test/format.test.ts
git commit -m "feat: formatSql 純関数と paramTypes 構築 (TDD)"
```

### Task 4: VSCode 拡張エントリ `src/extension.ts` (TDD 適用外: VSCode API は単体テスト不可)

**Files:**
- Create: `src/extension.ts`
- Modify: `tsconfig.json` (作成)

- [ ] **Step 1: `tsconfig.json` を作成**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "out",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "moduleResolution": "node"
  },
  "include": ["src"],
  "exclude": ["node_modules", "test", "poc", "out"]
}
```

- [ ] **Step 2: `src/extension.ts` を実装**

```ts
import * as vscode from 'vscode';
import { formatSql, type FormatterConfig } from './format';

function getConfig(): FormatterConfig {
  const c = vscode.workspace.getConfiguration('sqlTemplateFormatter');
  return {
    dialect: c.get<string>('dialect', 'postgresql'),
    placeholderPatterns: c.get<string[]>('placeholderPatterns', []),
    positionalTokens: c.get<string[]>('positionalTokens', []),
    namedPrefixes: c.get<string[]>('namedPrefixes', []),
    keywordCase: c.get<string>('keywordCase', 'upper'),
  };
}

function tryFormat(text: string, config: FormatterConfig, editorOptions: { tabSize: number; insertSpaces: boolean }): string | undefined {
  try {
    return formatSql(text, config, editorOptions);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showWarningMessage(`SQL Template Formatter: ${msg}`);
    return undefined;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const fullProvider: vscode.DocumentFormattingEditProvider = {
    provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
      const options = {
        tabSize: document.options.tabSize,
        insertSpaces: document.options.insertSpaces === true,
      };
      const formatted = tryFormat(document.getText(), getConfig(), options);
      if (formatted === undefined) {
        return [];
      }
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      );
      return [vscode.TextEdit.replace(fullRange, formatted)];
    },
  };

  const rangeProvider: vscode.DocumentRangeFormattingEditProvider = {
    provideDocumentRangeFormattingEdits(
      document: vscode.TextDocument,
      range: vscode.Range
    ): vscode.TextEdit[] {
      const options = {
        tabSize: document.options.tabSize,
        insertSpaces: document.options.insertSpaces === true,
      };
      const formatted = tryFormat(document.getText(range), getConfig(), options);
      if (formatted === undefined) {
        return [];
      }
      return [vscode.TextEdit.replace(range, formatted)];
    },
  };

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider('sql', fullProvider),
    vscode.languages.registerDocumentRangeFormattingEditProvider('sql', rangeProvider)
  );
}

export function deactivate(): void {}
```

- [ ] **Step 3: 型チェックでコンパイル確認**

```bash
bunx tsc -p ./ --noEmit
```

Expected: エラーなし。`FormatOptions` が sql-formatter からエクスポートされていない場合のみ、`src/format.ts` で `FormatOptions` の代わりにローカル型定義を使う (下記)。

```ts
type ParamTypes = {
  positional?: boolean | string[];
  named?: string[];
  quoted?: string[];
  custom?: Array<{ regex: RegExp | string }>;
};
```

- [ ] **Step 4: ビルド確認**

```bash
bun run compile
```

Expected: `out/extension.js` と `out/format.js` が生成される

- [ ] **Step 5: Commit**

```bash
git add tsconfig.json src/extension.ts src/format.ts package.json
git commit -m "feat: sql 言語向け FormattingProvider (全文/選択範囲) を登録"
```

### Task 5: VSCode で手動動作確認

- [ ] **Step 1: F5 で Extension Development Host を起動し、.sql ファイルで確認**

1. このプロジェクトを VSCode で開く
2. F5 (Run Extension) → Extension Development Host が起動
3. 新規 `.sql` ファイルを作成し、以下をペースト:

```sql
SELECT * FROM users WHERE id = ${user_id} AND status = ${status};
```

4. `Shift+Alt+F` → 整形されること
5. `WHERE name = '${name}'` を含む SQL を選択範囲だけ `Shift+Alt+F` → 範囲のみ整形されること
6. `editor.formatOnSave: true` にして保存 → 自動整形されること
7. 不正 SQL (`SELECT FROM WHERE;`) で `Shift+Alt+F` → 警告が出てファイルが変更されないこと
8. settings.json で `sqlTemplateFormatter.keywordCase` を `lower` に → 小文字になること

- [ ] **Step 2: (任意) 実プロジェクトの .sql ファイル数件で試す** — エラーが起きないことを確認

### Task 6: README と .vscodeignore

**Files:**
- Create: `README.md`
- Create: `.vscodeignore`

- [ ] **Step 1: `.vscodeignore` を作成**

```gitignore
.vscode/**
.vscode-test/**
src/**
test/**
poc/**
docs/**
node_modules/**
**/*.map
.gitignore
bunfig.toml
bun.lock
tsconfig.json
```

- [ ] **Step 2: `README.md` を作成**

```markdown
# SQL Template Formatter

Python プロジェクトなどで使われる .sql ファイルのテンプレートプレースホルダーを
壊さずに SQL を整形する VSCode 拡張機能です。既存の SQL フォーマッターが
`${XXX}` を文法エラーとして扱う問題を解決します。

## 機能

- `Shift+Alt+F` (Format Document) / 選択範囲のフォーマット / `editor.formatOnSave` に対応
- プレースホルダーをそのまま保持: `${var}` `{var}` `{{ var }}` `%s` `%(name)s`
- 方言を選択可能: PostgreSQL (既定) / BigQuery / MySQL / SQLite / Snowflake など
  (sql-formatter が対応する全方言)

## インストール

- ビルド: `bun install && bun run compile`
- .vsix 生成: `bun run package` → 生成された .vsix を VSCode の
  Extensions ビュー → `...` → `Install from VSIX...` でインストール

既存の SQL フォーマッター拡張機能とは競合します。本拡張を使う場合は
settings.json で既定フォーマッターを指定し、他の SQL フォーマッター拡張は無効化してください:

```json
{
  "[sql]": {
    "editor.defaultFormatter": "sql-template-formatter.sql-template-formatter",
    "editor.formatOnSave": true
  }
}
```

## 設定

| 設定 | 既定値 | 説明 |
|---|---|---|
| `sqlTemplateFormatter.dialect` | `postgresql` | 方言 (postgresql, bigquery, mysql, sqlite, snowflake など) |
| `sqlTemplateFormatter.placeholderPatterns` | `${...}`, `{{...}}`, `{...}`, `%(name)s` の正規表現 4 件 | プレースホルダーの正規表現配列。**先頭のパターンほど優先** |
| `sqlTemplateFormatter.positionalTokens` | `["%s"]` | 位置パラメータとして扱う固定トークン |
| `sqlTemplateFormatter.namedPrefixes` | `[]` | 名前付きパラメータのプレフィックス。`":"` は PostgreSQL の `::` キャストと衝突するため注意 |
| `sqlTemplateFormatter.keywordCase` | `upper` | キーワードの大文字小文字 (preserve/upper/lower/capitalize) |

### プレースホルダーのカスタマイズ例

```json
{
  "sqlTemplateFormatter.placeholderPatterns": [
    "\\$\\{[^}]+\\}",
    "\\{\\{[\\s\\S]*?\\}\\}",
    "\\{[^{}]*\\}",
    "%\\([^)]*\\)s",
    "@\\w+"
  ],
  "sqlTemplateFormatter.namedPrefixes": [":"]
}
```

## 注意事項

- `{...}` パターンは JSON リテラル (`SELECT '{"a":1}'::jsonb;`) と誤マッチする
  リスクがあります。文字列リテラル内はレキサーが文字列として先に処理するため通常は
  安全ですが、問題が起きたらこのパターンを削除してください。
- Jinja2 の制御構文 (`{% for %}` など) には対応していません。
- マッチ順はパターン配列の順序どおりです。Jinja2 の `{{ }}` は単一の `{ }` より
  先に指定してください (既定値はこの順序になっています)。

## 開発

```bash
bun install
bun run compile   # tsc ビルド
bun test          # 単体テスト (bun:test)
bun run package   # .vsix 生成
```

F5 で Extension Development Host を起動して動作確認できます。

## ライセンス

MIT
```

- [ ] **Step 3: Commit**

```bash
git add README.md .vscodeignore
git commit -m "docs: README (使い方・設定・競合回避) と .vscodeignore を追加"
```

### Task 7: .vsix パッケージングとローカル検証

- [ ] **Step 1: パッケージング**

```bash
bun run package
```

Expected: `sql-template-formatter-0.0.1.vsix` が生成される

- [ ] **Step 2: ローカルインストール検証**

1. VSCode → Extensions → `...` → `Install from VSIX...` → 生成された .vsix
2. .sql ファイルで `Shift+Alt+F` が動くこと
3. 既存の vscode-sql-formatter が入っていたら無効化し、`[sql].editor.defaultFormatter` を設定して formatOnSave が動くこと

- [ ] **Step 3: バージョンタグ**

```bash
git tag v0.0.1
git add package.json
git commit -m "chore: v0.0.1 リリース準備"
```

### Task 8: Marketplace 公開手順の README 化 (実行はユーザー判断)

- [ ] **Step 1: README に「公開」セクションを追記**

```markdown
## Marketplace への公開

1. https://marketplace.visualstudio.com/manage で Publisher を作成する
   (Azure DevOps アカウントが必要)
2. `package.json` の `publisher` を自分の Publisher ID に変更する
3. Azure DevOps の Personal Access Token (Marketplace 管理スコープ) を作成し、
   `VSCE_PAT` 環境変数に設定する (平文コミット禁止。dotenvx 等で管理)
4. 実行: `bun run publish`
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: Marketplace 公開手順を追記"
```
