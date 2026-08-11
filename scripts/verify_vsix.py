#!/usr/bin/env python3
"""Verify a packaged .vsix contains exactly the expected files and no leaks.

Defense layer 2: exact inventory check. Defense layer 3: leak-pattern scan.
Usage: python3 scripts/verify_vsix.py [path/to/*.vsix ...]
Default: newest sql-template-formatter-*.vsix in the repo root.
Exits non-zero on any violation.
"""
import glob
import os
import sys
import zipfile

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ALLOWED_NODE_MODULES = {
    "sql-formatter",
    "argparse",
    "nearley",
    "moo",
    "railroad-diagrams",
    "randexp",
    "discontinuous-range",
    "ret",
}
ALLOWED_NESTED_MODULES = {("nearley", "node_modules", "commander")}

EXPECTED_TOP_LEVEL = {"package.json", "icon.png", "readme.md", "LICENSE.txt"}
REQUIRED_TOP_LEVEL = {"package.json", "icon.png", "readme.md", "LICENSE.txt"}
REQUIRED_OUT = {"out/extension.js", "out/format.js", "out/ordinals.js"}

LEAK_PATTERNS = (
    ".code-review-graph",
    ".claude",
    ".headroom",
    ".cursor",
    ".kiro",
    ".qoder",
    ".gemini",
    ".codebuddy",
    ".superpowers",
    "scratch/",
    ".github/",
    ".git/",
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    "CODEBUDDY.md",
    "QODER.md",
    ".mcp.json",
    "opencode.jsonc",
    ".vscodeignore",
    ".windsurfrules",
    ".cursorrules",
    "node_modules/.bin/",
    ".map",
)


def verify(path):
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
    ext = [n for n in names if n.startswith("extension/")]
    problems = []

    leaks = [n for n in ext if any(p in n for p in LEAK_PATTERNS)]
    if leaks:
        problems.append("leak patterns found:\n  " + "\n  ".join(leaks))

    top_level = set()
    bad = []
    for n in ext:
        rest = n[len("extension/"):]
        if rest.startswith("out/"):
            continue
        if rest.startswith("node_modules/"):
            parts = rest.split("/")
            if len(parts) >= 2 and parts[1] in ALLOWED_NODE_MODULES:
                continue
            if tuple(parts[1:4]) in ALLOWED_NESTED_MODULES:
                continue
            bad.append(n)
        elif "/" not in rest:
            top_level.add(rest)
        else:
            bad.append(n)
    if bad:
        problems.append("files outside allowed inventory:\n  " + "\n  ".join(bad))

    missing_top = REQUIRED_TOP_LEVEL - top_level
    if missing_top:
        problems.append("missing top-level files: " + ", ".join(sorted(missing_top)))
    unexpected_top = top_level - EXPECTED_TOP_LEVEL
    if unexpected_top:
        problems.append("unexpected top-level files: " + ", ".join(sorted(unexpected_top)))

    out_files = {n[len("extension/"):] for n in ext if n.startswith("extension/out/")}
    missing_out = REQUIRED_OUT - out_files
    if missing_out:
        problems.append("missing out/ files: " + ", ".join(sorted(missing_out)))

    if problems:
        print(f"FAIL {path} ({len(ext)} files)")
        for p in problems:
            print("  - " + p)
        return False
    print(f"OK   {path} ({len(ext)} files)")
    return True


def main():
    args = sys.argv[1:]
    if not args:
        candidates = sorted(
            glob.glob(os.path.join(REPO_ROOT, "sql-template-formatter-*.vsix")),
            key=os.path.getmtime,
        )
        if not candidates:
            print("no .vsix found; run: bun run package")
            return 1
        args = [candidates[-1]]
    results = [verify(a) for a in args]
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
