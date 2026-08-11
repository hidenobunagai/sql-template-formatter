# SQL Template Formatter - 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Python プロジェクトの .sql ファイルに含まれるテンプレートプレースホルダー (`${var}`, `{var}`, `{{ var }}`, `%s`, `%(name)s`) を壊さずに SQL フォーマットできる VSCode 拡張機能を新規作成する。

**Architecture:** 既存拡張 (kufii/vscode-sql-formatter) のフォークではなく、最小の TypeScript 拡張を新規実装する。マスク方式は採らず、`sql-formatter` v15+ の `paramTypes.custom` に settings の正規表現を**文字列のまま**渡すだけの薄いラッパーにする。全文フォーマット + 選択範囲フォーマットの両 provider を sql 言語に登録し、VSCode 標準の Shift+Alt+F / formatOnSave をそのまま使う。

**Tech Stack:** TypeScript, VSCode Extension API, `sql-formatter` (v15+), bun (パッケージ管理・テスト), `@vscode/vsce` (パッケージング)

**Phase 0 PoC で実測済みの事実 (sql-formatter@15.8.2):**
- `paramTypes.custom` は**文字列の正規表現**で渡す (RegExp オブジェクトはエラー/無効)
- 全パターン `${}`, `{}`, `{{}}`, `%s`, `%(name)s` が1クエリ内で共存・保持される
- `?` は paramTypes 指定なしでも既定で位置パラメータ
- `5 % 2` の剰余演算子は `%s` パターンと共存できる。文字列内 `'${name}'` も安全
- `named: [':']` は `::` キャストを壊さない (既定は OFF)
- `SELECT FROM WHERE;` は throw しない。エラーテストには文字列閉じ忘れ `'abc` を使う

---

### Task 1: プロジェクト初期化 (完了済み)

`git init`, `.gitignore`, `bunfig.toml`, `LICENSE`, `docs/`, `package.json` (設定・依存込み),
`bun install --ignore-scripts` (sql-formatter@15.8.2) は済んでいる。何もする必要はない。

### Task 2: PoC 検証スクリプト (完了済み)

`poc/format-poc.ts`, `poc/variants.ts`, `poc/variants2.ts`, `poc/final.ts` で全パターンの
実測出力を確認済み。テスト期待値はこの実測値を使用する。

### Task 3: コア実装 `src/format.ts` (TDD)

**Files:**
- Create: `src/format.ts`
- Create: `test/format.test.ts`

- [ ] **Step 1: 失敗するテストを書く** (期待値はすべて PoC 実測出力)

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
    '%s',
  ],
  namedPrefixes: [],
  keywordCase: 'upper',
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
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
bun test
```

Expected: FAIL (`Cannot find module '../src/format'` 相当)

- [ ] **Step 3: 最小実装を書く** (custom に文字列をそのまま渡す。`new RegExp` しないこと)

```ts
import { format, type FormatOptions } from 'sql-formatter';

export type Dialect = NonNullable<FormatOptions['language']>;
export type KeywordCase = NonNullable<FormatOptions['keywordCase']>;

export interface FormatterConfig {
  dialect: string;
  placeholderPatterns: string[];
  namedPrefixes: string[];
  keywordCase: string;
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

export function formatSql(
  sql: string,
  config: FormatterConfig,
  editorOptions?: EditorOptions
): string {
  const paramTypes: FormatOptions['paramTypes'] = {};
  if (config.placeholderPatterns.length > 0) {
    paramTypes.custom = config.placeholderPatterns.map((regex) => ({ regex }));
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

Expected: 15 tests all PASS

- [ ] **Step 5: Commit**

```bash
git add src/format.ts test/format.test.ts
git commit -m "feat: formatSql 純関数と paramTypes 構築 (TDD, PoC 実測値で検証)"
```

### Task 4: VSCode 拡張エントリ `src/extension.ts`

**Files:**
- Create: `src/extension.ts`
- Create: `tsconfig.json`

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
    namedPrefixes: c.get<string[]>('namedPrefixes', []),
    keywordCase: c.get<string>('keywordCase', 'upper'),
  };
}

function tryFormat(
  text: string,
  config: FormatterConfig,
  editorOptions: { tabSize: number; insertSpaces: boolean }
): string | undefined {
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

- [ ] **Step 3: ビルド確認**

```bash
bun run compile
```

Expected: `out/extension.js` と `out/format.js` が生成され、エラーなし
(もし `FormatOptions` が sql-formatter からエクスポートされていなければ、
`src/format.ts` で `FormatOptions` の代わりにローカル型 `ParamTypes` を定義し、
`paramTypes` を `ParamTypes` として構築して `format(sql, { ..., paramTypes })` に渡す)

- [ ] **Step 4: Commit**

```bash
git add tsconfig.json src/extension.ts
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
7. `SELECT * FROM users WHERE name = 'abc;` で `Shift+Alt+F` → 警告が出てファイルが変更されないこと
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
| `sqlTemplateFormatter.placeholderPatterns` | `${...}`, `{{...}}`, `{...}`, `%(name)s`, `%s` の正規表現 5 件 | プレースホルダーの正規表現**文字列**配列。**先頭のパターンほど優先** |
| `sqlTemplateFormatter.namedPrefixes` | `[]` | 名前付きパラメータのプレフィックス (例: `[":"]`)。`::` キャストとは共存可能 |
| `sqlTemplateFormatter.keywordCase` | `upper` | キーワードの大文字小文字 (preserve/upper/lower/capitalize) |

### プレースホルダーのカスタマイズ例

```json
{
  "sqlTemplateFormatter.placeholderPatterns": [
    "\\$\\{[^}]+\\}",
    "\\{\\{[\\s\\S]*?\\}\\}",
    "\\{[^{}]*\\}",
    "%\\([^)]*\\)s",
    "%s",
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
- プレースホルダーのパターンは文字列で指定してください (RegExp オブジェクトでは
  ありません。settings.json は常に文字列です)。

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

- [ ] **Step 3: リリース準備**

```bash
git add package.json
git commit -m "chore: v0.0.1 リリース準備"
git tag v0.0.1
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
