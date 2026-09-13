# Changelog

Notable changes to the **SQL Template Formatter** VS Code extension.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

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
