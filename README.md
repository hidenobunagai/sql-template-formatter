# SQL Template Formatter

Python プロジェクトなどで使われる .sql ファイルのテンプレートプレースホルダーを壊さずに SQL を整形する VSCode 拡張機能です。既存の SQL フォーマッターが `${XXX}` を文法エラーとして扱う問題を解決します。

## 機能

- `Shift+Alt+F` (Format Document) / 選択範囲のフォーマット / `editor.formatOnSave` に対応
- プレースホルダーをそのまま保持: `${var}` `{var}` `{{ var }}` `%s` `%(name)s`
- 方言を選択可能: PostgreSQL (既定) / BigQuery / MySQL / SQLite / Snowflake など (sql-formatter が対応する全方言)

## インストール

- ビルド: `bun install && bun run compile`
- .vsix 生成: `bun run package` → 生成された .vsix を VSCode の Extensions ビュー → `...` → `Install from VSIX...` でインストール

既存の SQL フォーマッター拡張機能とは競合します。本拡張を使う場合は settings.json で既定フォーマッターを指定し、他の SQL フォーマッター拡張は無効化してください:

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
| `sqlTemplateFormatter.keywordCase` | `upper` | キーワードの大文字小文字 (preserve/upper/lower) |

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

- `{...}` パターンは JSON リテラル (`SELECT '{"a":1}'::jsonb;`) と誤マッチするリスクがあります。文字列リテラル内はレキサーが文字列として先に処理するため通常は安全ですが、問題が起きたらこのパターンを削除してください。
- Jinja2 の制御構文 (`{% for %}` など) には対応していません。
- マッチ順はパターン配列の順序どおりです。Jinja2 の `{{ }}` は単一の `{ }` より先に指定してください (既定値はこの順序になっています)。
- プレースホルダーのパターンは文字列で指定してください (RegExp オブジェクトではありません。settings.json は常に文字列です)。

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
