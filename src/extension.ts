import * as vscode from 'vscode';
import { formatSql, type FormatterConfig } from './format';

/**
 * Settings for one document: passing it as the scope picks up `[sql]`
 * language-specific overrides and, in a multi-root workspace, the settings of
 * the folder the file lives in.
 */
function getConfig(document: vscode.TextDocument): FormatterConfig {
  const c = vscode.workspace.getConfiguration('sqlTemplateFormatter', document);
  return {
    dialect: c.get<string>('dialect', 'postgresql'),
    placeholderPatterns: c.get<string[]>('placeholderPatterns', []),
    namedPrefixes: c.get<string[]>('namedPrefixes', []),
    keywordCase: c.get<string>('keywordCase', 'upper'),
    replaceOrdinals: c.get<boolean>('replaceOrdinals', true),
    commaPosition: c.get<string>('commaPosition', 'after'),
    keepFunctionsInline: c.get<boolean>('keepFunctionsInline', false),
  };
}

function tryFormat(
  text: string,
  config: FormatterConfig,
  editorOptions: { tabSize: number; insertSpaces: boolean }
): string | undefined {
  try {
    return formatSql(text, config, editorOptions);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showWarningMessage(`SQL Template Formatter: ${msg}`);
    return undefined;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const fullProvider: vscode.DocumentFormattingEditProvider = {
    provideDocumentFormattingEdits(
      document: vscode.TextDocument,
      options: vscode.FormattingOptions
    ): vscode.TextEdit[] {
      const editorOptions = { tabSize: options.tabSize, insertSpaces: options.insertSpaces };
      const formatted = tryFormat(document.getText(), getConfig(document), editorOptions);
      if (formatted === undefined) {
        return [];
      }
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      );
      return [vscode.TextEdit.replace(fullRange, formatted)];
    },
  };

  const rangeProvider: vscode.DocumentRangeFormattingEditProvider = {
    provideDocumentRangeFormattingEdits(
      document: vscode.TextDocument,
      range: vscode.Range,
      options: vscode.FormattingOptions
    ): vscode.TextEdit[] {
      const editorOptions = { tabSize: options.tabSize, insertSpaces: options.insertSpaces };
      const formatted = tryFormat(document.getText(range), getConfig(document), editorOptions);
      if (formatted === undefined) {
        return [];
      }
      return [vscode.TextEdit.replace(range, formatted)];
    },
  };

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider('sql', fullProvider),
    vscode.languages.registerDocumentRangeFormattingEditProvider('sql', rangeProvider)
  );
}

export function deactivate(): void {}
