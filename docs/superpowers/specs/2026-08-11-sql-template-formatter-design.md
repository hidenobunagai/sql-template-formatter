# SQL Template Formatter — VSCode 拡張機能 設計

日付: 2026-08-11
状態: 承認済み (ユーザー確認済み, {name} パターンは既定 ON)

## 1. 目的

Python プロジェクトで大量に使われる .sql ファイル内のテンプレートプレースホルダー
(`${XXX}`, `{XXX}`, `{{ XXX }}`, `%s`, `%(name)s` など) が SQL 文法として無効なため、
既存の vscode-sql-formatter ではフォーマットエラーになる。これを解決する専用
VSCode 拡張機能を新規作成する。

## 2. 方針 (確定済みの判断)

- **マスク方式は採らない**: 既存フォーマッターの提案(プレースホルダーを `__VAR_N__` に
  置換→整形→復元)は、復元漏れ・`__VAR_N__` との衝突リスクがある。
- **`sql-formatter` v15+ の `paramTypes` 機能を使う**: `${...}` などをパラメータトークン
  として正規表現で直接認識させる。マスクコードは一切不要。
  - `paramTypes.custom`: 正規表現の配列 (`${...}` `{{...}}` `{...}` `%(name)s`)
  - `paramTypes.positional`: 固定トークンの配列 (`%s`)
  - `paramTypes.named`: プレフィックス配列 (既定 OFF。PostgreSQL の `::` キャストと
    衝突するため任意で ON)
- **フォークしない**: kufii/vscode-sql-formatter は旧 API のため、新規の最小拡張として
  実装する。ランタイム依存は `sql-formatter` の 1 つだけ。
- **既存拡張との競合**: 両方が sql 言語のフォーマッターを登録するため、ユーザーは
  `[sql].editor.defaultFormatter` で本拡張を指定し、既存拡張は無効化する前提。
  README に記載する。

## 3. アーキテクチャ

```
.formatSql(sql, cfg)            // 純関数 (テスト可能)
  → sqlFormatter.format(sql, {
       language: cfg.dialect,
       keywordCase: cfg.keywordCase,
       tabWidth: <editor 設定>,
       useTabs: <editor 設定>,
       paramTypes: {
         custom:     [regex...],   // settings から
         positional: ['%s'],       // settings から
         named:      undefined,    // 既定 OFF
       }
     })
```

- `src/format.ts`: `formatSql()` 純関数 + paramTypes 構築ロジック
- `src/extension.ts`: `activate()` で 2 つの provider を sql 言語に登録
  - `DocumentFormattingEditProvider` (全文)
  - `DocumentRangeFormattingEditProvider` (選択範囲)
  - → VSCode 標準の Shift+Alt+F / formatOnSave がそのまま動く。独自コマンド不要。
- フォーマット失敗時: `vscode.window.showWarningMessage` にエラーを表示し、
  TextEdit を返さない (ファイルは変更しない。保存はブロックしない)。

## 4. 設定 (contributes.configuration)

| 設定キー | 既定値 | 説明 |
|---|---|---|
| `sqlTemplateFormatter.dialect` | `postgresql` | sql-formatter の方言名 (bigquery/mysql/sqlite/snowflake 等) |
| `sqlTemplateFormatter.placeholderPatterns` | `["\\$\\{[^}]+\\}", "\\{\\{[\\s\\S]*?\\}\\}", "\\{[^\\{\\}]*\\}", "%\\([^)]*\\)s"]` | 正規表現配列。順序 = マッチ優先度 (Jinja2 を先に) |
| `sqlTemplateFormatter.positionalTokens` | `["%s"]` | 固定トークン |
| `sqlTemplateFormatter.namedPrefixes` | `[]` | `:` は `::` キャストと衝突するため任意で ON |
| `sqlTemplateFormatter.keywordCase` | `upper` | キーワードの大文字/小文字 |

決定: 単一 `{name}` パターンは既定 ON (ユーザー承認済み)。JSON リテラル
`'{"a":1}'` との誤マッチリスクは README に注意書きとして記載。

## 5. エッジケース方針

- 文字列内の `'${name}'`: レキサーが文字列トークンを先に消費するためそのまま保持される。
- 複数行 `${...}`: `[^}]` は改行にマッチするため問題なし (s フラグ不要)。
- `::` キャスト: `named` 既定 OFF で回避。
- Jinja2 制御構文 `{% for %}`: 対応外。README に明記。

## 6. テスト (bun:test, 追加依存なし)

- WHERE の数値位置 `${id}`
- 文字列リテラル内 `'${name}'`
- `FROM ${table}`
- `%s` (positional)
- `%(name)s`
- `{{ var }}` (Jinja2)
- `{var}` (単一括弧)
- 複数行プレースホルダー
- 不正 SQL → throw → 呼び出し側のエラーハンドリング

## 7. ファイル構成

```
package.json          # contributes: configuration/languages; activationEvents
tsconfig.json
src/extension.ts      # provider 登録 + エラーハンドリング
src/format.ts         # formatSql() 純関数
test/format.test.ts   # bun:test
README.md             # 使い方・設定・競合回避・配布手順
LICENSE               # MIT (Marketplace 公開に必須)
.vscodeignore         # vsce パッケージ対象の除外
bunfig.toml           # minimumReleaseAge (供給チェーン対策)
```

yo code は使わない (npm 依存の対話型ジェネレータのため手書きでスキャフォールド)。

## 8. ロードマップ

| Phase | 内容 | 完了条件 |
|---|---|---|
| 0 | PoC: Node スクリプトで paramTypes 方式を実プロジェクトの .sql ファイルで検証 | 全パターンがエラーなく整形・復元される |
| 1 | 拡張機能実装 (format.ts → テスト → extension.ts + settings) | bun:test 全パス |
| 2 | F5 デバッグ、formatOnSave / 選択範囲、README | 手動動作確認済み |
| 3 | `vsce package` → .vsix ローカルインストール検証 | .vsix インストールで動作 |
| 4 | Marketplace 公開 (Publisher 作成 + `vsce publish`) | 公開手順の README 化、公開 |

## 9. 将来の拡張 (やらないこと)

- Jinja2 制御構文 `{% %}` の専用対応
- プレースホルダー内のインデント調整
- esbuild バンドル (読み込み時間が問題になったら検討)
