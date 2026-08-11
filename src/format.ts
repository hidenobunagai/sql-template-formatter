import { format, type KeywordCase, type SqlLanguage } from 'sql-formatter';

type ParamTypes = {
  positional?: boolean;
  numbered?: ('?' | ':' | '$')[];
  named?: (':' | '@' | '$')[];
  quoted?: (':' | '@' | '$')[];
  custom?: Array<{ regex: string; key?: (text: string) => string }>;
};

export type Dialect = SqlLanguage;

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
  const paramTypes: ParamTypes = {};
  if (config.placeholderPatterns.length > 0) {
    paramTypes.custom = config.placeholderPatterns.map((regex) => ({ regex }));
  }
  if (config.namedPrefixes.length > 0) {
    paramTypes.named = config.namedPrefixes as ParamTypes['named'];
  }
  return format(sql, {
    language: config.dialect as Dialect,
    keywordCase: config.keywordCase as KeywordCase,
    tabWidth: editorOptions?.tabSize ?? 2,
    useTabs: editorOptions ? !editorOptions.insertSpaces : false,
    paramTypes,
  });
}
