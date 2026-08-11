import { format, type FormatOptions } from 'sql-formatter';

export type Dialect = NonNullable<FormatOptions['language']>;
export type KeywordCase = NonNullable<FormatOptions['keywordCase']>;

export interface FormatterConfig {
  dialect: string;
  placeholderPatterns: string[];
  namedPrefixes: string[];
  keywordCase: string;
}

export const DEFAULT_PLACEHOLDER_PATTERNS = [
  '\\$\\{[^}]+\\}',
  '\\{\\{[\\s\\S]*?\\}\\}',
  '\\{[^{}]*\\}',
  '%\\([^)]*\\)s',
  '%s',
];

export interface EditorOptions {
  tabSize: number;
  insertSpaces: boolean;
}

export function formatSql(
  sql: string,
  config: FormatterConfig,
  editorOptions?: EditorOptions
): string {
  const paramTypes: FormatOptions['paramTypes'] = {};
  if (config.placeholderPatterns.length > 0) {
    paramTypes.custom = config.placeholderPatterns.map((regex) => ({ regex }));
  }
  if (config.namedPrefixes.length > 0) {
    paramTypes.named = config.namedPrefixes;
  }
  return format(sql, {
    language: config.dialect as Dialect,
    keywordCase: config.keywordCase as KeywordCase,
    tabWidth: editorOptions?.tabSize ?? 2,
    useTabs: editorOptions ? !editorOptions.insertSpaces : false,
    paramTypes,
  });
}
