# SQL Template Formatter Extension Icon Design Spec

## Overview
Create and integrate an official icon for the `SQL Template Formatter` VS Code extension to improve visual identity on VS Code Marketplace, Open VSX, and inside the VS Code editor UI.

## Visual Design Specs
- **Theme**: Dark mode, modern developer tool aesthetic.
- **Background**: Deep slate navy gradient (`#0F172A` to `#1E293B`) with smooth rounded corners.
- **Main Emblem**:
  - A glowing cyan/teal SQL database cylinder (`#06B6D4` / `#38BDF8`).
  - Integrated overlay of template braces `${ }` representing Python/Jinja/template parameters.
  - Aligned code layout bars symbolizing automatic SQL formatting and beautification.
- **File Format**: PNG format, 512x512 pixels high resolution.
- **File Location**: `icon.png` in project root directory.

## Implementation Changes
1. **Asset Generation**: Generate `icon.png` using AI image generation tool matching the specification.
2. **`package.json` Update**: Add `"icon": "icon.png"` property to the manifest.
3. **Verification**: Confirm `package.json` syntax is valid and `icon.png` exists in root directory.

## Success Criteria
- `icon.png` is generated and saved cleanly at project root.
- `package.json` references `icon.png` in `"icon"`.
- `bun run package` builds `.vsix` successfully with icon included.
