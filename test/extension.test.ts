import { beforeAll, describe, expect, mock, test } from 'bun:test';

// A minimal stand-in for the `vscode` module: enough to activate the extension
// and capture the providers and settings lookups it makes.
const settings: Record<string, unknown> = {};
const scopes: unknown[] = [];
const warnings: string[] = [];
const providers: Record<string, any> = {};

class Range {
  constructor(
    readonly start: unknown,
    readonly end: unknown
  ) {}
}

mock.module('vscode', () => ({
  Range,
  TextEdit: { replace: (range: unknown, newText: string) => ({ range, newText }) },
  window: { showWarningMessage: (message: string) => warnings.push(message) },
  workspace: {
    getConfiguration: (section: string, scope?: unknown) => {
      scopes.push(scope);
      return {
        get: <T>(key: string, fallback: T): T =>
          (`${section}.${key}` in settings ? settings[`${section}.${key}`] : fallback) as T,
      };
    },
  },
  languages: {
    registerDocumentFormattingEditProvider: (_: string, p: unknown) => (providers.full = p),
    registerDocumentRangeFormattingEditProvider: (_: string, p: unknown) => (providers.range = p),
  },
}));

function documentOf(text: string) {
  return { getText: () => text, positionAt: (offset: number) => offset };
}

const options = { tabSize: 2, insertSpaces: true };

beforeAll(async () => {
  const extension = await import('../src/extension');
  extension.activate({ subscriptions: [] } as never);
  settings['sqlTemplateFormatter.placeholderPatterns'] = ['\\$\\{[^}]+\\}'];
});

describe('VS Code extension', () => {
  test('formats the whole document', () => {
    const edits = providers.full.provideDocumentFormattingEdits(documentOf('select ${c} from t;\n'), options);
    expect(edits).toEqual([{ range: new Range(0, 20), newText: 'SELECT\n  ${c}\nFROM\n  t;\n' }]);
  });

  test('reads settings for the document being formatted', () => {
    scopes.length = 0;
    const document = documentOf('select 1;');
    providers.full.provideDocumentFormattingEdits(document, options);
    expect(scopes).toEqual([document]);
  });

  test('shows a warning and changes nothing on an invalid setting', () => {
    settings['sqlTemplateFormatter.keywordCase'] = 'shout';
    try {
      const edits = providers.full.provideDocumentFormattingEdits(documentOf('select 1;'), options);
      expect(edits).toEqual([]);
      expect(warnings.pop()).toContain('invalid keywordCase "shout"');
    } finally {
      delete settings['sqlTemplateFormatter.keywordCase'];
    }
  });
});
