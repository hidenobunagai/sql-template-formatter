# Extension Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a high-quality 512x512 icon PNG for `SQL Template Formatter` and register it in `package.json`.

**Architecture:** Generate `icon.png` using image generation tools according to spec, place it in project root, update manifest `"icon"` field, and verify with VS Code extension packaging (`vsce package` / `bun run package`).

**Tech Stack:** Image Generation, JSON (package.json), VSCE (@vscode/vsce)

## Global Constraints

- Icon file name: `icon.png` in project root.
- Dimensions: 512x512 PNG format.
- Visuals: Dark navy background (`#0F172A`), glowing cyan/blue SQL database cylinder (`#06B6D4`), template braces `${ }`, formatted layout lines.

---

### Task 1: Generate Extension Icon PNG Asset

**Files:**
- Create: `icon.png`

**Interfaces:**
- Consumes: Icon visual design spec (`docs/superpowers/specs/2026-08-11-extension-icon-design.md`)
- Produces: `icon.png` in workspace root directory.

- [ ] **Step 1: Generate icon image**

Prompt `generate_image` with exact prompt matching spec:
"A professional, modern 1:1 app icon logo for a developer tool named SQL Template Formatter. Deep navy blue slate gradient background (#0F172A to #1E293B) with smooth rounded app icon corners. Center features a glowing neon cyan SQL database cylinder icon integrated with stylish template code braces `${}` and neat aligned formatting code lines. Clean, vibrant cyan and bright blue lighting accents (#06B6D4, #38BDF8), vector graphic aesthetic, high contrast, sleek and minimalist developer aesthetic."

- [ ] **Step 2: Verify icon.png existence**

Run: `ls -la icon.png`
Expected: `icon.png` exists in project root.

- [ ] **Step 3: Commit icon asset**

```bash
git add icon.png
git commit -m "feat: add extension icon image"
```

---

### Task 2: Register Icon in Manifest and Verify Package Build

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: `icon.png`
- Produces: Updated `package.json` with `"icon": "icon.png"` and verified `vsce package` build.

- [ ] **Step 1: Update package.json**

Add `"icon": "icon.png"` to `package.json`.

- [ ] **Step 2: Verify package.json syntax**

Run: `bun test`
Expected: Existing tests pass and package.json is valid JSON.

- [ ] **Step 3: Test extension packaging**

Run: `bun run package`
Expected: Successfully packages `.vsix` file including `icon.png`.

- [ ] **Step 4: Commit manifest changes**

```bash
git add package.json
git commit -m "feat: register extension icon in package.json"
```
