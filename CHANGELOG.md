# Changelog

Notable changes to the **SQL Template Formatter** VS Code extension.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

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
