# Changelog

Notable changes to the **SQL Template Formatter** VS Code extension.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **`replaceOrdinals` no longer changes what a query means.** GROUP BY now copies the column's expression instead of its alias (PostgreSQL resolves a GROUP BY name to an input column first, so `date_trunc('day', created_at) AS created_at … GROUP BY 1` used to become a grouping by the raw column). An ordinal is kept when its expression mentions any output alias, is a bare constant, holds a placeholder, or is an aggregate (GROUP BY); the ORDER BY of a `UNION` / `EXCEPT` / `INTERSECT` keeps its ordinals; an ORDER BY alias is only used when it is unique. A `::` cast is no longer read as an alias (`created_at::date` → `GROUP BY date`), operand keywords (`a IS NULL`, `b LIKE c`) are never taken for implicit aliases, and `DISTINCT` / `DISTINCT ON (…)` / `TOP n` are skipped when reading the first column (`ORDER BY DISTINCT upper(a)`).

- **String literals are never rewritten by the post-passes.** `commaPosition: "before"` and `keepFunctionsInline` used to treat `\` as an escape in every dialect, so a PostgreSQL `'C:\'` flipped string state and the next multi-line literal got a comma moved into it or its newline replaced by a space. All three post-passes (ordinal replacement, function re-joining, comma moving) now share one lexer (`src/scan.ts`) built from sql-formatter's own per-dialect rules — quote types and escapes, `E'…'` / `$tag$…$tag$` strings, quoted identifiers, `#` / `//` line comments only where the dialect has them, nested block comments — and it matches the configured placeholders first, exactly like sql-formatter. As a result a comma inside a multi-line placeholder (`{a,\nb}`) stays put, a PostgreSQL `#>>` operator no longer hides the rest of its line, an ordinal-looking `group by 1` inside a multi-line string literal is left alone, and a moved comma lands on the next item instead of an intervening comment line.

- **Invalid settings are rejected instead of corrupting the output.** An unknown `keywordCase` made sql-formatter drop every keyword (with `--write`, the file lost its `SELECT` / `FROM`), a non-numeric `--tab-width` removed all indentation, and an unknown `commaPosition` silently fell back to `after`. `dialect`, `keywordCase`, `commaPosition`, `namedPrefixes`, and the tab width are now validated; the extension shows the error as a warning and leaves the document unchanged, and the CLI exits with code 2 before touching any file.

- **A placeholder pattern that can match an empty string no longer hangs the formatter.** sql-formatter's tokenizer never advances past an empty token, so a pattern such as `x*` looped forever — in VS Code, freezing the whole extension host. Such patterns, and patterns that do not compile, are now rejected with a message naming the pattern.

- **`keepFunctionsInline` no longer squashes CTEs and subqueries onto one line.** Any `word (` used to count as a function call, so `WITH x AS (SELECT … JOIN … WHERE …)`, `IN (SELECT …)`, `EXISTS (…)`, and `FROM (SELECT …)` collapsed into single lines hundreds of characters long. Only a paren a name touches (`SUM(`) is a call now — sql-formatter prints calls without a space and keyword parens with one.

- **The default `%s` placeholder pattern no longer matches the start of a name.** `a%size` was split into `a %s ize`; the pattern is now `%s(?![A-Za-z0-9_])`. If you copied the old defaults into `sqlTemplateFormatter.placeholderPatterns` or `.sql-formatter.json`, update that entry too.

- **CLI errors exit with code 2, never 1.** A missing or unreadable file crashed with a stack trace and exit code 1 — the same code `--check` uses for "not formatted", so CI could not tell them apart — and an earlier error was overwritten by a later unformatted file. Read, parse, and write errors (stdin included) now print one line and exit 2, which outranks 1.
- **The post-passes run in linear time.** `keepFunctionsInline` re-ran a regex over the whole output at every `(`, adding about 3 s to a 4000-row `INSERT`; the shared lexer now answers that in constant time.

- **Language-specific and per-folder settings are honoured.** The extension read its settings without a scope, so `"[sql]": { "sqlTemplateFormatter.…": … }` and multi-root folder settings were ignored. Settings are now read for the document being formatted, and every setting is declared `language-overridable`.
- **The `namedPrefixes` description no longer claims `:` breaks `::` casts** (it does not; the README was right).

### Added

- **`sqlTemplateFormatter.dialect` lists the supported dialects**, so VS Code offers completion and flags typos in settings.json.
- **CLI `--named-prefix <p>` (repeatable) and `namedPrefixes` / `paramTypes.named` in `.sql-formatter.json`**, the CLI counterparts of the extension's `sqlTemplateFormatter.namedPrefixes`.

### Changed

- **The extension and the CLI are esbuild bundles.** `out/extension.js` and `out/cli.js` now inline sql-formatter, so the VSIX shrinks from 445 files / 950 KB to 9 files / 450 KB with no `node_modules`, and the npm package has no runtime dependencies. `scripts/verify_vsix.py` now requires exactly the two bundles, and the publish workflow runs the CLI from the unpacked npm tarball.
- **Publishing is gated on tests and a matching tag.** A new `verify` job in `publish.yml` checks that the pushed tag equals `v` + the `package.json` version, builds, and runs the tests; both publishing jobs wait for it. `vsce` and `ovsx` now run from `node_modules` (pinned by `bun.lock`, `ovsx` added as a dev dependency) instead of `npx --yes` fetching the latest release into a job holding the marketplace tokens, and the npm upgrade is pinned to `11.20.0` instead of `@latest`.
- **CI runs on pushes to `main` and on pull requests** (plus manual runs) instead of twice for every PR branch push, with Bun pinned like the publish workflow. `bun run test` compiles first (`pretest`), since the CLI tests run the built `out/cli.js`.
- **The CLI picks the `.sql-formatter.json` nearest to each file** instead of the one nearest to the working directory, so `sql-template-formatter --check a/x.sql b/y.sql` honours `a/` and `b/` configs. stdin still uses the working directory.

### Removed

- **Repository clutter**: the `poc/` experiments, the one-off icon scripts in `scratch/`, the `.superpowers/` progress ledger, the empty `.mcp.json` / `opencode.jsonc`, and `package-lock.json`. `bun.lock` is the only lockfile — CI and both publish jobs install with `bun --frozen-lockfile`, and the npm lockfile had already drifted from it (it still listed `sql-formatter` as a runtime dependency). None of these were ever packaged.

## [0.0.16] - 2026-09-25

### Changed

- **`commaPosition: "before"` keeps a space after the moved comma again** (`id` / `    , name`). 0.0.15 briefly removed the space; the spaced form is the wanted style after all. The default `after` output is unaffected.

## [0.0.15] - 2026-09-25

### Changed

- **`commaPosition: "before"` now emits the moved comma without a following space** (`id` / `    ,name` instead of `, name`), per user feedback. The default `after` output is unaffected.

## [0.0.14] - 2026-09-24

### Added

- **`keepFunctionsInline` (default `false`)** — re-joins the line breaks sql-formatter inserts inside `word(...)` groups so `SUM(...)`, `COUNT(CASE … END)`, and nested calls stay on one line. sql-formatter has no option for this and breaks `CASE` structurally regardless of `expressionWidth`, so the re-join runs as a post-pass: it removes only code-state newlines, copying string literals, `$$…$$` bodies, and comment interiors verbatim, and the newline that terminates a `-- comment` is kept so no commented-out code can result. Available as the VS Code setting `sqlTemplateFormatter.keepFunctionsInline`, the CLI flag `--keep-functions-inline`, and a `keepFunctionsInline` key in `.sql-formatter.json`.

## [0.0.13] - 2026-09-24

### Added

- **`commaPosition` (`after` | `before`, default `after`)** — chooses where the comma of a wrapped item sits. The default reproduces the previous output byte for byte; `before` moves the comma to the start of the next line (`id` / `    , name`) and keeps a trailing `-- comment` with its own item. Available as the VS Code setting `sqlTemplateFormatter.commaPosition`, the CLI flag `--comma-position`, and a `commaPosition` key in `.sql-formatter.json`. Because this formatter has no reformat-until-stable gate, the mover scans the whole text carrying string, dollar-quote, and comment state across line breaks: a comma inside a multi-line `'…'`, a `$$…$$` body, or a comment is never moved.

## [0.0.12] - 2026-09-18

Publish-pipeline hardening: the three registries (VS Code Marketplace, Open VSX, npm) now fail and retry independently, so a partial failure can be re-run instead of burning a version. **No formatter behavior changes** — `src/` and `test/` are untouched since v0.0.11.

### Changed

- **npm publishes with [trusted publishing (OIDC)](https://docs.npmjs.com/trusted-publishers) instead of an `NPM_TOKEN` secret**: the npm job declares `id-token: write`, upgrades the runner's npm to ≥ 11.5.1 (the bundled one is older and cannot do OIDC), and publishes with no credential at all. Provenance attestations are now attached automatically, and there is no token to rotate — which matters because npm is retiring bypass-2FA tokens for direct publishing. README release steps updated to match.
- **Both marketplace publishes are retry-safe**: `vsce publish` and `ovsx publish` now pass `--skip-duplicate`. Neither registry allows republishing a version and they fail independently (Open VSX can return 503 while the VS Code Marketplace succeeds), so without the flag a re-run would stop at the already-published registry and never reach the other one.
- **Open VSX is retried up to 4 times, 30 s apart.** It answers 503 intermittently (three times on 2026-09-17 across two repositories) and can even fail a request after accepting the upload; `--skip-duplicate` makes such a retry report success instead of a bogus failure.

### Fixed

- **The npm job is idempotent**: it checks `npm view sql-template-formatter@$VERSION` first and skips the publish when that version is already on the registry, so re-running the workflow to retry the marketplaces no longer fails on the version npm already has.
- `package.json` is now exactly what npm's publish-time normalization produces: the `bin` path is `out/cli.js` (not `./out/cli.js`) and `repository.url` uses the `git+https://…git` form. npm 11 **removes** a `./`-prefixed bin entry while publishing — the 0.0.11 tarball kept its executable only because npm rewrote the manifest — so the manifest no longer depends on that rewrite; `ci.yml` runs `npm pkg fix` and fails if it drifts again.
- The npm script `publish` is renamed to `publish:vsce`. npm runs a script named `publish` as a lifecycle step of `npm publish`, so the first successful npm release re-ran `vsce publish` inside the npm job (without `VSCE_PAT`) and reported the job as failed *after* the package had already been published. Documented in the README release steps.

## [0.0.11] - 2026-09-17

First release that also ships to **npm**: the formatter is now available as a CLI (`npx sql-template-formatter`) built on the extension's own core, so the same placeholder handling and ordinal replacement work in CI, pre-commit, and AI-agent hooks. This release also fixes the file's final newline being dropped on every format.

### Added

- **CLI** (`npx sql-template-formatter`): formats `.sql` files or stdin through the extension's own core (`src/format.ts` + `src/ordinals.ts`), so placeholders (`${var}`, `{{ var }}`, `%s`, `%(name)s`) and `GROUP BY` / `ORDER BY` ordinal replacement behave identically to the editor. Options: `--write`, `--check`, `--dialect`, `--keyword-case`, `--no-ordinals`, `--tab-width` / `--tabs`, `--config`; the nearest `.sql-formatter.json` is discovered automatically. Registered as the package `bin`, so it is usable from npm, CI, pre-commit, and AI-agent hooks.
- `.npmignore`: publishes only `out/` (plus package.json / README / CHANGELOG / LICENSE). It is required because `.gitignore` ignores `out/` and npm falls back to `.gitignore` — while `files` in package.json cannot be used here, since VSCE aborts on an extension that has both a `.vscodeignore` and a `files` property.
- `test/cli.test.ts`: 11 end-to-end cases driving the built CLI (file → stdout, stdin, `--write` idempotence, `--check` exit codes, `--no-ordinals`, `.sql-formatter.json` discovery, unknown dialect, missing file argument, `--version`, trailing-newline preservation).
- `Publish` workflow: npm publish step (guarded by the `NPM_TOKEN` secret at the time; switched to trusted publishing right after — see 0.0.12).

### Changed

- README: new "CLI" section (usage, options, config file) plus a hook note — format at the end of an agent turn rather than right after every write, because rewriting a file the agent just wrote invalidates text it may still try to edit.

### Fixed

- **The file's final newline is no longer dropped.** `sql-formatter` re-prints the parse tree, so the newline after the last statement belonged to no node and was silently removed — every formatted file then showed `\ No newline at end of file` in `git diff`, and `--check` could never pass on a normal newline-terminated file (its output could not equal the input). `formatSql` now preserves the input's final-newline state: exactly one `\n` when the input had one, none when it did not. This fixes the extension (format-on-save) and the CLI together — fixing only the CLI would have made the two fight over the last byte in repos where both run. Line endings stay LF-normalized (the Prettier default).
- `test/format.test.ts`: +5 cases for the trailing-newline contract (kept, collapsed when repeated, not added, idempotent, placeholder-only input).
- `test/cli.test.ts`: +2 cases (`--write` keeps the newline / does not add one); the `formatted.sql` fixture is now newline-terminated, so `--check` passing is a regression guard for the bug above.

## [0.0.10] - 2026-09-13

First release published by the tag-triggered `Publish` workflow (VS Code Marketplace + Open VSX).
It bundles everything on `main` since **v0.0.7**, which was the last git tag: 0.0.8 and 0.0.9 were published manually without tags (0.0.8 reached the VS Code Marketplace only), so this is the first tagged release since then.

**No formatter behavior changes** — `src/` and `test/` are untouched since v0.0.7. This release is packaging hardening, docs, and repository hygiene.

### Added

- `.github/workflows/publish.yml`: publishes to the VS Code Marketplace (VSCE) and Open VSX (OVSX) on `v*` tag push.
- 3-layer VSIX leak defense: `.vscodeignore` rules, `scripts/verify_vsix.py` (exact file inventory + agent-artifact leak scan), and VSIX packaging in CI (`.github/workflows/ci.yml`).
- `CHANGELOG.md` (this file), included in the published package.
- README "How it works" section: placeholders are registered with `sql-formatter` v15+ as `paramTypes.custom` parameter tokens instead of masking, plus an Archify interactive architecture diagram (`architecture.html` / `architecture.png`, repo-only).
- `package-lock.json`, so npm-based tooling resolves the same tree as `bun.lock`.
- Icon transparency helper scripts under `scratch/` (repo-only, never packaged).

### Changed

- `.vscodeignore` now keeps `scratch/`, `.superpowers/`, `scripts/`, and the README-only images (`architecture.*`, `how_it_works.png`, `problem.png`) out of the VSIX.

### Removed

- Legacy agent/tooling artifacts: `.cursorrules`, `.cursor/`, `.kiro/`, `.qoder/`, `.codebuddy/`, `.gemini/`, `.claude/`, `.windsurfrules`, `.vscode/mcp.json`, `.github/code-review-graph.instruction.md`, and the repo-root `AGENTS.md` / `CLAUDE.md` / `CODEBUDDY.md` / `GEMINI.md` / `QODER.md` copies.
- Excalidraw infographics (`how_it_works.png`, `problem.png`), replaced by the architecture diagram above.

### Security

- `.gitignore` excludes `.env` / `.env.*` (dotenvx-encrypted files must be added explicitly).
- MCP configs no longer embed a developer's absolute local paths.

[0.0.10]: https://github.com/hidenobunagai/sql-template-formatter/compare/v0.0.7...v0.0.10
[0.0.11]: https://github.com/hidenobunagai/sql-template-formatter/compare/v0.0.10...v0.0.11
[0.0.12]: https://github.com/hidenobunagai/sql-template-formatter/compare/v0.0.11...v0.0.12
