/**
 * Static analysis of placeholder patterns.
 *
 * sql-formatter's tokenizer never advances past an empty token, so a
 * placeholder pattern whose preferred match at some position is empty hangs
 * it. Probing sample inputs cannot rule that out (`(?<=a)(?=b)` matches empty
 * only between an `a` and a `b`), and scanning the real input at every offset
 * costs quadratic time on patterns like `a+$`. Instead this computes a lower
 * bound on the length of any match from the pattern's syntax: if the bound is
 * at least 1, no input can produce an empty match.
 *
 * The bound is conservative: lookarounds, anchors, and backreferences count
 * as zero-width, so a pattern is only accepted when every alternative
 * consumes a character on its own.
 */

/** Cap for the running lower bound; only "zero or not" matters to callers. */
const CAP = 1 << 20;

class Parser {
  private i = 0;

  constructor(private readonly source: string) {}

  /** Lower bound on the match length of the whole pattern. */
  parse(): number {
    const min = this.alternation();
    if (this.i !== this.source.length) throw new SyntaxError(`unexpected ")" at ${this.i}`);
    return min;
  }

  private peek(offset = 0): string | undefined {
    return this.source[this.i + offset];
  }

  private alternation(): number {
    let min = this.sequence();
    while (this.peek() === '|') {
      this.i += 1;
      min = Math.min(min, this.sequence());
    }
    return min;
  }

  private sequence(): number {
    let sum = 0;
    while (this.i < this.source.length && this.peek() !== '|' && this.peek() !== ')') {
      sum = Math.min(CAP, sum + this.term());
    }
    return sum;
  }

  private term(): number {
    const atom = this.atom();
    const repeat = this.quantifierMin();
    return repeat === undefined ? atom : Math.min(CAP, atom * repeat);
  }

  /** Minimum repetition count of a quantifier after an atom, if there is one. */
  private quantifierMin(): number | undefined {
    const ch = this.peek();
    let min: number | undefined;
    if (ch === '*' || ch === '?') {
      this.i += 1;
      min = 0;
    } else if (ch === '+') {
      this.i += 1;
      min = 1;
    } else if (ch === '{') {
      const match = /^\{(\d+)(?:,\d*)?\}/.exec(this.source.slice(this.i));
      if (match === null) return undefined;
      this.i += match[0].length;
      min = Math.min(CAP, Number(match[1]));
    } else {
      return undefined;
    }
    if (this.peek() === '?') this.i += 1; // lazy
    return min;
  }

  private atom(): number {
    const ch = this.peek();
    if (ch === '^' || ch === '$') {
      this.i += 1;
      return 0;
    }
    if (ch === '.') {
      this.i += 1;
      return 1;
    }
    if (ch === '[') {
      this.skipClass();
      return 1;
    }
    if (ch === '(') return this.group();
    if (ch === '\\') return this.escape();
    // A literal; a surrogate pair is one character either way.
    this.i += ch !== undefined && /[\uD800-\uDBFF]/.test(ch) ? 2 : 1;
    return 1;
  }

  private group(): number {
    this.i += 1; // (
    let lookaround = false;
    if (this.peek() === '?') {
      const rest = this.source.slice(this.i + 1);
      if (rest.startsWith('=') || rest.startsWith('!')) {
        lookaround = true;
        this.i += 2;
      } else if (rest.startsWith('<=') || rest.startsWith('<!')) {
        lookaround = true;
        this.i += 3;
      } else if (rest.startsWith('<')) {
        this.i = this.source.indexOf('>', this.i) + 1; // (?<name>
      } else {
        const modifiers = /^[a-z-]*:/.exec(rest); // (?: and (?ims-ims:
        this.i += 1 + (modifiers?.[0].length ?? 0);
      }
    }
    const min = this.alternation();
    if (this.peek() !== ')') throw new SyntaxError(`unterminated group at ${this.i}`);
    this.i += 1;
    return lookaround ? 0 : min;
  }

  private escape(): number {
    const next = this.peek(1);
    this.i += 2;
    if (next === 'b' || next === 'B') return 0; // word boundary assertion
    if (next !== undefined && /[1-9]/.test(next)) {
      while (/\d/.test(this.peek() ?? '')) this.i += 1;
      return 0; // backreference: the group it repeats may be empty
    }
    if (next === 'k' && this.peek() === '<') {
      this.i = this.source.indexOf('>', this.i) + 1;
      return 0; // named backreference
    }
    if ((next === 'p' || next === 'P' || next === 'u') && this.peek() === '{') {
      this.i = this.source.indexOf('}', this.i) + 1;
    } else if (next === 'u') {
      this.i += 4;
    } else if (next === 'x') {
      this.i += 2;
    } else if (next === 'c') {
      this.i += 1;
    }
    return 1; // \d \w \s \n \t \0 \/ \. … all match exactly one character
  }

  private skipClass(): void {
    this.i += 1; // [
    if (this.peek() === '^') this.i += 1; // in JS a `]` right here closes `[]` / `[^]`
    while (this.i < this.source.length && this.peek() !== ']') {
      this.i += this.peek() === '\\' ? 2 : 1;
    }
    this.i += 1; // ]
  }
}

/**
 * True when some input could make `pattern` match the empty string — i.e. a
 * lower bound on its match length is zero. `pattern` must already compile
 * with the `u` flag.
 */
export function canMatchEmpty(pattern: string): boolean {
  return new Parser(pattern).parse() === 0;
}
