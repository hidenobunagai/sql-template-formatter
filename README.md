# SQL Template Formatter

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/HidenobuNagai.sql-template-formatter?label=VS%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=HidenobuNagai.sql-template-formatter)
[![Visual Studio Marketplace Downloads](https://img.shields.io/visual-studio-marketplace/d/HidenobuNagai.sql-template-formatter)](https://marketplace.visualstudio.com/items?itemName=HidenobuNagai.sql-template-formatter)
[![Open VSX Version](https://img.shields.io/open-vsx/v/HidenobuNagai/sql-template-formatter?label=Open%20VSX)](https://open-vsx.org/extension/HidenobuNagai/sql-template-formatter)

A VS Code extension that formats `.sql` files containing template placeholders (common in Python projects) without breaking them. Existing SQL formatters treat `${XXX}` as a syntax error; this one does not.

## Features

- Works with `Shift+Alt+F` (Format Document), selection formatting, and `editor.formatOnSave`
- Placeholders are kept intact: `${var}` `{var}` `{{ var }}` `%s` `%(name)s`
- `GROUP BY 1, 2` / `ORDER BY 1` ordinals are replaced with the referenced column names (disable with `sqlTemplateFormatter.replaceOrdinals: false`)
- Dialect selectable: PostgreSQL (default) / BigQuery / MySQL / SQLite / Snowflake and more (all dialects supported by sql-formatter)

## How it works

Existing SQL formatters treat template placeholders (`${var}`, `{{ var }}`, `%s` …) as syntax errors and refuse to format such files. This extension avoids masking entirely: it registers the placeholder patterns with `sql-formatter` v15+ as parameter tokens (`paramTypes.custom`), so the SQL is formatted with the placeholders kept intact.

[![SQL Template Formatter Architecture](architecture.png)](architecture.html)

> 🔍 **[Open Interactive Architecture Diagram](architecture.html)** — Explore components, guided views, and pipeline trace.


## Install

- Visual Studio Marketplace: [HidenobuNagai.sql-template-formatter](https://marketplace.visualstudio.com/items?itemName=HidenobuNagai.sql-template-formatter)
- Open VSX (VSCodium etc.): [HidenobuNagai/sql-template-formatter](https://open-vsx.org/extension/HidenobuNagai/sql-template-formatter)
- From VSIX: run `bun run package`, then in VS Code go to Extensions view → `...` → `Install from VSIX...`

This extension conflicts with other SQL formatter extensions. When using it, set it as the default formatter in settings.json and disable the others:

```json
{
  "[sql]": {
    "editor.defaultFormatter": "HidenobuNagai.sql-template-formatter",
    "editor.formatOnSave": true
  }
}
```

## Settings

| Setting | Default | Description |
|---|---|---|
| `sqlTemplateFormatter.dialect` | `postgresql` | Dialect (postgresql, bigquery, mysql, sqlite, snowflake, etc.) |
| `sqlTemplateFormatter.placeholderPatterns` | Regexes for `${...}`, `{{...}}`, `{...}`, `%(name)s`, `%s` (5 entries) | Array of placeholder regex **strings**. **Earlier patterns take priority** |
| `sqlTemplateFormatter.namedPrefixes` | `[]` | Prefixes for named parameters (e.g. `[":"]`). Compatible with `::` casts |
| `sqlTemplateFormatter.keywordCase` | `upper` | Keyword casing (preserve/upper/lower) |
| `sqlTemplateFormatter.replaceOrdinals` | `true` | Replace `GROUP BY`/`ORDER BY` ordinals (e.g. `1, 2`) with the referenced column names. Ordinals referencing placeholder expressions, aggregates without alias, or `SELECT *` are left untouched |

### Customizing placeholders

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

## Notes

- The `{...}` pattern can falsely match JSON literals (e.g. `SELECT '{"a":1}'::jsonb;`). Text inside string literals is normally safe because the lexer processes strings first, but remove this pattern if you run into issues.
- Jinja2 control constructs (`{% for %}` etc.) are not supported.
- Patterns match in array order. Put Jinja2's `{{ }}` before single `{ }` (the defaults already do).
- Patterns are strings, not RegExp objects (settings.json values are always strings anyway).

## Development

```bash
bun install
bun run compile   # tsc build
bun test          # unit tests (bun:test)
bun run package   # build .vsix
```

Press F5 to launch an Extension Development Host for manual testing.

## Release (maintainers)

1. Bump the version in `package.json` and tag it: `git tag vX.Y.Z`
2. VS Marketplace: run `bun run publish` with `VSCE_PAT` set
3. Open VSX: run `bunx ovsx publish -p $OVSX_PAT` with `OVSX_PAT` set

Never commit PATs in plain text. Manage them with dotenvx or similar.

## License

MIT
