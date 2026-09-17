#!/usr/bin/env node
/**
 * Command-line interface for SQL Template Formatter.
 *
 * Formats `.sql` files (or stdin) containing template placeholders, reusing the
 * exact same core as the VS Code extension (`src/format.ts`).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_PLACEHOLDER_PATTERNS, formatSql, type FormatterConfig } from './format';

const CONFIG_FILENAME = '.sql-formatter.json';

interface FileConfig {
  language?: string;
  keywordCase?: string;
  tabWidth?: number;
  useTabs?: boolean;
  replaceOrdinals?: boolean;
  placeholderPatterns?: string[];
  paramTypes?: { custom?: Array<{ regex: string }> };
}

const USAGE = `Usage: sql-template-formatter [options] [files...]

Formats SQL with template placeholders (\${var}, {{ var }}, %s, %(name)s) kept intact.
Reads stdin and writes stdout when no files are given.

Options:
  -w, --write              Rewrite files in place
      --check              Exit 1 if any input is not already formatted
  -l, --dialect <name>     SQL dialect (default: postgresql)
  -k, --keyword-case <c>   upper | lower | preserve (default: upper)
      --no-ordinals        Keep GROUP BY 1 / ORDER BY 1 ordinals as-is
      --tab-width <n>      Indent width (default: 2)
      --tabs               Indent with tabs
  -c, --config <file>      Config JSON (default: nearest ${CONFIG_FILENAME})
  -h, --help               Show this help
      --version            Show version`;

function findConfig(startDir: string): FileConfig {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) {
      return JSON.parse(readFileSync(candidate, 'utf8')) as FileConfig;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return {};
    }
    dir = parent;
  }
}

function buildConfig(
  fileConfig: FileConfig,
  values: Record<string, unknown>
): FormatterConfig {
  const fromFile = fileConfig.placeholderPatterns ?? fileConfig.paramTypes?.custom?.map((p) => p.regex);
  return {
    dialect: (values.dialect as string) ?? fileConfig.language ?? 'postgresql',
    placeholderPatterns:
      fromFile && fromFile.length > 0 ? fromFile : DEFAULT_PLACEHOLDER_PATTERNS,
    namedPrefixes: [],
    keywordCase: (values['keyword-case'] as string) ?? fileConfig.keywordCase ?? 'upper',
    replaceOrdinals: !values['no-ordinals'] && (fileConfig.replaceOrdinals ?? true),
  };
}

function main(): number {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        write: { type: 'boolean', short: 'w', default: false },
        check: { type: 'boolean', default: false },
        dialect: { type: 'string', short: 'l' },
        'keyword-case': { type: 'string', short: 'k' },
        'no-ordinals': { type: 'boolean', default: false },
        'tab-width': { type: 'string' },
        tabs: { type: 'boolean', default: false },
        config: { type: 'string', short: 'c' },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', default: false },
      },
      allowPositionals: true,
    });
  } catch (err) {
    console.error(`sql-template-formatter: ${(err as Error).message}`);
    return 2;
  }

  const { values, positionals } = parsed;
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (values.version) {
    const pkg = JSON.parse(
      readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
    ) as { version: string };
    console.log(pkg.version);
    return 0;
  }

  let fileConfig: FileConfig;
  try {
    fileConfig = values.config
      ? (JSON.parse(readFileSync(values.config, 'utf8')) as FileConfig)
      : findConfig(process.cwd());
  } catch (err) {
    console.error(`sql-template-formatter: cannot read config: ${(err as Error).message}`);
    return 2;
  }

  const config = buildConfig(fileConfig, values);
  const editorOptions = {
    tabSize: Number(values['tab-width'] ?? fileConfig.tabWidth ?? 2),
    insertSpaces: !(values.tabs || fileConfig.useTabs === true),
  };

  const format = (text: string): string => formatSql(text, config, editorOptions);

  if (positionals.length === 0) {
    if (values.write) {
      console.error('sql-template-formatter: --write needs at least one file');
      return 2;
    }
    const input = readFileSync(0, 'utf8');
    const output = format(input);
    if (values.check) {
      return output === input ? 0 : 1;
    }
    process.stdout.write(output);
    return 0;
  }

  let status = 0;
  for (const file of positionals) {
    const input = readFileSync(file, 'utf8');
    let output: string;
    try {
      output = format(input);
    } catch (err) {
      console.error(`sql-template-formatter: ${file}: ${(err as Error).message}`);
      status = 2;
      continue;
    }
    if (values.check) {
      if (output !== input) {
        console.error(`sql-template-formatter: ${file} is not formatted`);
        status = 1;
      }
    } else if (values.write) {
      if (output !== input) {
        writeFileSync(file, output);
      }
    } else {
      process.stdout.write(output);
    }
  }
  return status;
}

process.exitCode = main();
