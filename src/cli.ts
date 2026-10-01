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
import {
  DEFAULT_PLACEHOLDER_PATTERNS,
  formatSql,
  validateConfig,
  type EditorOptions,
  type FormatterConfig,
} from './format';

const CONFIG_FILENAME = '.sql-formatter.json';

interface FileConfig {
  language?: string;
  keywordCase?: string;
  tabWidth?: number;
  useTabs?: boolean;
  replaceOrdinals?: boolean;
  commaPosition?: string;
  keepFunctionsInline?: boolean;
  placeholderPatterns?: string[];
  namedPrefixes?: string[];
  paramTypes?: { custom?: Array<{ regex: string }>; named?: string[] };
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
      --comma-position <p> after | before (default: after)
      --keep-functions-inline  Keep SUM(...) / COUNT(CASE ...) on one line
      --named-prefix <p>   Named parameter prefix (: | @ | $), repeatable
      --tab-width <n>      Indent width (default: 2)
      --tabs               Indent with tabs
  -c, --config <file>      Config JSON (default: the ${CONFIG_FILENAME} nearest to
                           each file, or to the working directory for stdin)
  -h, --help               Show this help
      --version            Show version`;

/** Path of the nearest `.sql-formatter.json` at or above `startDir`, if any. */
function findConfigPath(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

function readConfig(file: string): FileConfig {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as FileConfig;
  } catch (err) {
    throw new Error(`cannot read config ${file}: ${(err as Error).message}`);
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
    namedPrefixes:
      (values['named-prefix'] as string[] | undefined) ??
      fileConfig.namedPrefixes ??
      fileConfig.paramTypes?.named ??
      [],
    keywordCase: (values['keyword-case'] as string) ?? fileConfig.keywordCase ?? 'upper',
    replaceOrdinals: !values['no-ordinals'] && (fileConfig.replaceOrdinals ?? true),
    commaPosition: (values['comma-position'] as string) ?? fileConfig.commaPosition ?? 'after',
    keepFunctionsInline:
      values['keep-functions-inline'] === true || (fileConfig.keepFunctionsInline ?? false),
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
        'comma-position': { type: 'string' },
        'keep-functions-inline': { type: 'boolean', default: false },
        'named-prefix': { type: 'string', multiple: true },
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

  type Resolved = { config: FormatterConfig; editorOptions: EditorOptions };
  const build = (fileConfig: FileConfig): Resolved => ({
    config: buildConfig(fileConfig, values),
    editorOptions: {
      tabSize: Number(values['tab-width'] ?? fileConfig.tabWidth ?? 2),
      insertSpaces: !(values.tabs || fileConfig.useTabs === true),
    },
  });

  // Flag values are wrong for every file: report them once, before any write.
  try {
    const flagsOnly = build({});
    validateConfig(flagsOnly.config, flagsOnly.editorOptions);
  } catch (err) {
    console.error(`sql-template-formatter: ${(err as Error).message}`);
    return 2;
  }

  // Each file gets the config nearest to it (like Prettier); stdin gets the
  // one nearest to the working directory. --config overrides both. A config
  // is read and validated once; its error names the config file.
  const resolved = new Map<string, Resolved | Error>();
  const resolveFor = (dir: string): Resolved => {
    const configPath = values.config ?? findConfigPath(dir);
    const key = configPath ?? '';
    let entry = resolved.get(key);
    if (entry === undefined) {
      try {
        entry = build(configPath === undefined ? {} : readConfig(configPath));
        validateConfig(entry.config, entry.editorOptions);
      } catch (err) {
        // readConfig() already names the file; validation errors do not.
        const message = (err as Error).message;
        const named = configPath === undefined || message.startsWith('cannot read config');
        entry = new Error(named ? message : `${configPath}: ${message}`);
      }
      resolved.set(key, entry);
    }
    if (entry instanceof Error) throw entry;
    return entry;
  };
  const format = (text: string, dir: string): string => {
    const { config, editorOptions } = resolveFor(dir);
    return formatSql(text, config, editorOptions);
  };

  if (positionals.length === 0) {
    if (values.write) {
      console.error('sql-template-formatter: --write needs at least one file');
      return 2;
    }
    let input: string;
    let output: string;
    try {
      input = readFileSync(0, 'utf8');
      output = format(input, process.cwd());
    } catch (err) {
      console.error(`sql-template-formatter: <stdin>: ${(err as Error).message}`);
      return 2;
    }
    if (values.check) {
      return output === input ? 0 : 1;
    }
    process.stdout.write(output);
    return 0;
  }

  // Preflight: resolve every file's config before formatting anything, so a
  // bad config for the last file cannot leave the earlier ones rewritten.
  // (A SQL syntax error still only shows up when its own file is formatted.)
  const configErrors = new Set<string>();
  for (const file of positionals) {
    try {
      resolveFor(path.dirname(file));
    } catch (err) {
      configErrors.add((err as Error).message);
    }
  }
  if (configErrors.size > 0) {
    for (const message of configErrors) console.error(`sql-template-formatter: ${message}`);
    return 2;
  }

  // 2 (an error) outranks 1 (unformatted): a run that could not check every
  // file must not look like it merely found formatting differences.
  let status = 0;
  for (const file of positionals) {
    try {
      const input = readFileSync(file, 'utf8');
      const output = format(input, path.dirname(file));
      if (values.check) {
        if (output !== input) {
          console.error(`sql-template-formatter: ${file} is not formatted`);
          status = Math.max(status, 1);
        }
      } else if (values.write) {
        if (output !== input) {
          writeFileSync(file, output);
        }
      } else {
        process.stdout.write(output);
      }
    } catch (err) {
      console.error(`sql-template-formatter: ${file}: ${(err as Error).message}`);
      status = 2;
    }
  }
  return status;
}

process.exitCode = main();
