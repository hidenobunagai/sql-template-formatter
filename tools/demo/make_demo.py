"""Render the README demo (docs/demo.mp4 + docs/demo.gif).

    uv run --no-project --with pillow --with pygments python tools/demo/make_demo.py

Every "after" snippet and every CLI line comes from the real tool
(`bun src/cli.ts`), so rerunning this keeps the demo honest. The screen shows
the command users actually type (`npx sql-template-formatter ...`).

Editor scenes use a fixed fit() camera: at 800px GIF width the code stays
readable (~16px), so every frame of a scene shares one camera and the
crossfades stay camera-consistent.
"""

import os
import re
import subprocess
import tempfile
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw

import demo_kit as k

# DEMO_REPO / DEMO_OUT let the script run against another checkout
ROOT = Path(os.environ.get("DEMO_REPO", Path(__file__).resolve().parents[2]))
OUT = Path(os.environ.get("DEMO_OUT", ROOT / "docs"))

MESSY = 'select u.id, u.name, count(o.id) as orders from ${schema}.users u left join {{ orders_table }} o on o.user_id = u.id where u.created_at >= %(start_date)s and u.plan = {plan} group by 1, 2 order by 3 desc'

# ${...} first so `${schema}` is not eaten by the bare {...} alternative
PH = r"\$\{[^}]*\}|\{\{[^}]*\}\}|\{[^{}]*\}|%\([^)]*\)s|%s(?![A-Za-z0-9_])"
LEX = "sql"
TITLE = "report.sql — SQL Template Formatter"
TAB = "report.sql"

CAP_BEFORE = "Template placeholders break most SQL formatters"
CAP_ACTION = "Shift+Alt+F — Format Document"
CAP_AFTER = "Formatted — placeholders stay intact"
CAP_ZOOM = "GROUP BY 1, 2 → real column names"
CAP_CLI = "Same core as a CLI — CI, pre-commit, agent hooks"


def run_tool(*args: str, stdin: str = "") -> str:
    """Real output of the project's own CLI, run from source."""
    return subprocess.run(
        [*map(str, args)], input=stdin, capture_output=True, text=True, check=True, cwd=ROOT
    ).stdout


def sql(lines: list[str], **kw):
    return k.highlight("\n".join(lines), LEX, placeholders=PH, **kw)


def card(title: str, sub: str, sub2: str) -> Image.Image:
    """Title card with a readable (large) third line."""
    img = Image.new("RGB", (k.W, k.H), k.BG)
    d = ImageDraw.Draw(img)
    d.text((k.W / 2, k.H / 2 - 70), title, font=k.TITLE, fill=k.FG, anchor="mm")
    d.text((k.W / 2, k.H / 2 + 30), sub, font=k.font("ui", 42), fill=k.ACCENT, anchor="mm")
    d.text((k.W / 2, k.H / 2 + 120), sub2, font=k.font("ui", 50), fill=(178, 186, 204), anchor="mm")
    return img


def keycap(img: Image.Image, x: float, y: float, text: str, alpha: float) -> Image.Image:
    """Large keycap-style key hint (x, y = top-left of the cap)."""
    if alpha <= 0:
        return img
    layer = Image.new("RGBA", img.size)
    d = ImageDraw.Draw(layer)
    font = k.font("ui_bold", 46)
    w, h = font.getlength(text) + 88, 84
    a = int(255 * alpha)
    d.rounded_rectangle((x + 6, y + 12, x + w + 6, y + h + 12), 18, fill=(0, 0, 0, int(160 * alpha)))
    d.rounded_rectangle((x, y, x + w, y + h), 18, fill=(48, 53, 68, a), outline=(*k.ACCENT, a), width=5)
    d.rounded_rectangle((x + 10, y + 10, x + w - 10, y + h - 10), 12,
                        outline=(126, 136, 158, int(170 * alpha)), width=2)
    d.text((x + w / 2, y + h / 2 - 2), text, font=font, fill=(255, 255, 255, a), anchor="mm")
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def code_cam(lines: list[str]):
    """Fixed camera framing the whole code block (rows 0..len(lines)-1)."""
    x1 = k.code_xy(0, 0)[0] + max(len(line) for line in lines) * k.MONO.getlength("M")
    return k.fit(k.MARGIN, k.code_xy(0, 0)[1] - 14, x1, k.code_xy(0, len(lines) - 1)[1] + k.LH + 8)


def prompt(text: str) -> list:
    """A typed command line: dimmed '$ ' prompt + the command."""
    return [("$ ", k.DIM, False), (text, k.FG, False)]


def frames():
    # 1. title card
    intro = card("SQL Template Formatter",
                 "Format SQL without breaking ${placeholders}",
                 "VS Code · CLI")
    yield from k.hold(intro, 2.0)

    # 2. "before": the messy one-liner in report.sql (wrapped for display only)
    # wrap for display without ever splitting a placeholder (spaces inside {{ }} are protected)
    protected = re.sub(r"\{\{[^}]*\}\}", lambda m: m.group(0).replace(" ", "\x00"), MESSY)
    before_lines = textwrap.fill(protected, width=70, break_long_words=False,
                                 break_on_hyphens=False).replace("\x00", " ").split("\n")
    before = k.editor(sql(before_lines), title=TITLE, tab=TAB,
                      cursor=(len(before_lines[-1]), len(before_lines) - 1))
    before_cam = code_cam(before_lines)
    print(f"before: {len(before_lines)} lines, camera zoom {before_cam[2]:.2f}"
          f" -> {24 * before_cam[2]:.0f}px code")
    yield from k.fade(intro, k.camera(before, *before_cam))
    yield from k.hold(before, 2.2, CAP_BEFORE, cam=before_cam)

    # 3. action: pointer -> keycap + tap, then the real formatted output
    target = k.code_xy(30, 1)
    cap_pos = (target[0] + 40, k.code_xy(0, len(before_lines))[1] + 8)
    yield from k.glide(before, 0.9, (k.W - 300, k.H - 250), target, CAP_ACTION, cam=before_cam)
    n = int(0.7 * k.FPS)
    tapped = before
    for i in range(n):
        p = min(1.0, (i + 1) / n)
        tapped = keycap(k.tap(before, *target, min(1.0, p * 1.4)), *cap_pos, "Shift+Alt+F", min(1.0, p * 3))
        yield k.caption(k.camera(tapped, *before_cam), CAP_ACTION)

    after_src = run_tool("bun", ROOT / "src/cli.ts", stdin=MESSY + "\n")
    rows = after_src.rstrip("\n").split("\n")
    after = k.editor(sql(rows), title=TITLE, tab=TAB)
    after_cam = code_cam(rows)
    print(f"after: {len(rows)} lines, camera zoom {after_cam[2]:.2f} -> {24 * after_cam[2]:.0f}px code")
    yield from k.fade(k.camera(tapped, *before_cam), k.camera(after, *after_cam), 0.6)
    yield from k.hold(after, 1.8, CAP_AFTER, cam=after_cam)

    # 4. camera: zoom onto the ordinal replacement (rows found in the output text)
    gb = next(i for i, line in enumerate(rows) if "GROUP BY" in line)
    ob = next(i for i, line in enumerate(rows) if "ORDER BY" in line)
    top = max(0, gb - 5)  # FROM/LEFT JOIN context above the block (also sets the frame width)
    code_w = max(len(line) for line in rows[top : ob + 2]) * k.MONO.getlength("M")
    box = (k.MARGIN, k.code_xy(0, top)[1] - 14, k.code_xy(0, 0)[0] + code_w, k.code_xy(0, ob + 1)[1] + k.LH + 8)
    focus = k.fit(*box)
    zoomed = k.editor(sql(rows), title=TITLE, tab=TAB, hl_rows=set(range(gb, ob + 2)))
    yield from k.pan(zoomed, 0.8, after_cam, focus)
    yield from k.hold(zoomed, 1.8, CAP_ZOOM, focus)

    # 5. CLI: real --check / --write / --check runs in a temp dir (relative paths only)
    with tempfile.TemporaryDirectory() as td:
        (Path(td) / "sql").mkdir()
        (Path(td) / "sql" / "report.sql").write_text(MESSY + "\n")

        def sh(cmd: str) -> tuple[int, str]:
            p = subprocess.run(cmd, shell=True, cwd=td, capture_output=True, text=True)
            return p.returncode, (p.stdout + p.stderr).strip()

        local = f"bun {ROOT / 'src/cli.ts'}"
        rc_check1, msg = sh(f"{local} --check sql/*.sql")
        sh(f"{local} --write sql/*.sql")
        rc_check2, _ = sh(f"{local} --check sql/*.sql")

    session: list = [
        ("cmd", "npx sql-template-formatter --check sql/*.sql", None),
        ("out", msg, k.RED),
        ("cmd", "echo $?", None),
        ("out", str(rc_check1), k.RED),
        ("cmd", "npx sql-template-formatter --write sql/*.sql", None),
        ("cmd", "npx sql-template-formatter --check sql/*.sql", None),
        ("cmd", "echo $?", None),
        ("out", str(rc_check2), k.GREEN),
    ]

    # a few short lines are tiny at 800px GIF width: frame the text area with a fixed camera
    x0, y0 = k.MARGIN + 36, 150
    longest = max(len(s[1]) + (2 if s[0] == "cmd" else 0) for s in session)
    cam = k.fit(x0, y0, x0 + longest * k.MONO.getlength("M"), y0 + len(session) * k.LH)
    print(f"terminal: camera zoom {cam[2]:.2f}")

    shown: list = []
    yield from k.fade(k.camera(zoomed, *focus), k.camera(k.terminal([]), *cam), 0.5)
    for kind, text, color in session:
        if kind == "cmd":
            yield from k.typing(lambda t: k.terminal(shown + [prompt(t + "▌")]), text, CAP_CLI,
                                cps=45, cam=cam)
            shown += [prompt(text)]
        else:
            shown += k.plain([text], color)
        yield from k.hold(k.terminal(shown), 0.6, CAP_CLI, cam)
    yield from k.hold(k.terminal(shown), 1.4, CAP_CLI, cam)

    # 6. outro
    outro = card("SQL Template Formatter",
                 "github.com/hidenobunagai/sql-template-formatter",
                 "VS Marketplace · Open VSX")
    yield from k.fade(k.camera(k.terminal(shown), *cam), outro, 0.6)
    yield from k.hold(outro, 2.4)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    k.encode(frames(), OUT / "demo.mp4", OUT / "demo.gif")
