// Dependency-free JSON5 -> JS value scanner.
//
// This is a real character-level tokeniser + recursive-descent parser, not a
// regex hack. It supports the subset of JSON5 the Harmony client's manifests
// actually use:
//   - double- and single-quoted strings, with escape sequences (\", \', \\,
//     \/, \b, \f, \n, \r, \t, \uXXXX, and line continuations)
//   - line comments (// ...) and block comments (/* ... */), correctly
//     ignored only *between* tokens -- a comment marker that appears inside
//     a string literal is just string content, never treated as a comment
//   - unquoted identifier object keys (e.g. `{ foo: 1 }`)
//   - trailing commas in both objects and arrays
//   - numbers (integers, decimals, exponents, leading +/-, 0x hex)
//   - the literals true / false / null
//
// On any syntax error it throws a real Error whose message includes the
// file path (when supplied) and a 1-based line:column position.

const PUNCTUATION = new Set(['{', '}', '[', ']', ':', ',']);

function isWhitespace(ch) {
  return (
    ch === ' ' ||
    ch === '\t' ||
    ch === '\r' ||
    ch === '\n' ||
    ch === '\v' ||
    ch === '\f' ||
    ch === '\uFEFF' ||
    ch === '\u00A0'
  );
}

function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

function isHexDigit(ch) {
  return isDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
}

function isIdentStart(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
}

function isIdentPart(ch) {
  return isIdentStart(ch) || isDigit(ch);
}

class Json5SyntaxError extends Error {}

function formatLocation(filePath, line, col) {
  return filePath ? `${filePath}:${line}:${col}` : `${line}:${col}`;
}

class Tokenizer {
  constructor(text, filePath) {
    this.text = text;
    this.filePath = filePath;
    this.pos = 0;
    this.line = 1;
    this.col = 1;
    this.length = text.length;
  }

  fail(message, line = this.line, col = this.col) {
    const loc = formatLocation(this.filePath, line, col);
    throw new Json5SyntaxError(`${message} at ${loc}`);
  }

  peekChar(offset = 0) {
    const p = this.pos + offset;
    return p < this.length ? this.text[p] : undefined;
  }

  advance() {
    const ch = this.text[this.pos];
    this.pos += 1;
    if (ch === '\n') {
      this.line += 1;
      this.col = 1;
    } else {
      this.col += 1;
    }
    return ch;
  }

  skipWhitespaceAndComments() {
    for (;;) {
      const ch = this.peekChar();
      if (ch === undefined) {
        return;
      }
      if (isWhitespace(ch)) {
        this.advance();
        continue;
      }
      if (ch === '/' && this.peekChar(1) === '/') {
        this.advance();
        this.advance();
        while (this.peekChar() !== undefined && this.peekChar() !== '\n') {
          this.advance();
        }
        continue;
      }
      if (ch === '/' && this.peekChar(1) === '*') {
        const startLine = this.line;
        const startCol = this.col;
        this.advance();
        this.advance();
        let closed = false;
        while (this.peekChar() !== undefined) {
          if (this.peekChar() === '*' && this.peekChar(1) === '/') {
            this.advance();
            this.advance();
            closed = true;
            break;
          }
          this.advance();
        }
        if (!closed) {
          this.fail('unterminated block comment', startLine, startCol);
        }
        continue;
      }
      return;
    }
  }

  readString(quote) {
    const startLine = this.line;
    const startCol = this.col;
    this.advance(); // opening quote
    let result = '';
    for (;;) {
      const ch = this.peekChar();
      if (ch === undefined) {
        this.fail('unterminated string literal', startLine, startCol);
      }
      if (ch === quote) {
        this.advance();
        return result;
      }
      if (ch === '\n') {
        this.fail('unterminated string literal (unescaped newline)', this.line, this.col);
      }
      if (ch === '\\') {
        this.advance();
        const esc = this.peekChar();
        if (esc === undefined) {
          this.fail('unterminated escape sequence', this.line, this.col);
        }
        switch (esc) {
          case '"':
            result += '"';
            this.advance();
            break;
          case "'":
            result += "'";
            this.advance();
            break;
          case '\\':
            result += '\\';
            this.advance();
            break;
          case '/':
            result += '/';
            this.advance();
            break;
          case 'b':
            result += '\b';
            this.advance();
            break;
          case 'f':
            result += '\f';
            this.advance();
            break;
          case 'n':
            result += '\n';
            this.advance();
            break;
          case 'r':
            result += '\r';
            this.advance();
            break;
          case 't':
            result += '\t';
            this.advance();
            break;
          case '\n':
            // line continuation: backslash-newline is elided
            this.advance();
            break;
          case '\r':
            this.advance();
            if (this.peekChar() === '\n') {
              this.advance();
            }
            break;
          case 'u': {
            this.advance();
            let hex = '';
            for (let i = 0; i < 4; i += 1) {
              const h = this.peekChar();
              if (h === undefined || !isHexDigit(h)) {
                this.fail('invalid unicode escape sequence', this.line, this.col);
              }
              hex += h;
              this.advance();
            }
            result += String.fromCharCode(parseInt(hex, 16));
            break;
          }
          default:
            this.fail(`invalid escape sequence '\\${esc}'`, this.line, this.col);
        }
        continue;
      }
      result += ch;
      this.advance();
    }
  }

  readNumber() {
    const startLine = this.line;
    const startCol = this.col;
    let str = '';
    if (this.peekChar() === '+' || this.peekChar() === '-') {
      str += this.advance();
    }
    if (this.peekChar() === '0' && (this.peekChar(1) === 'x' || this.peekChar(1) === 'X')) {
      str += this.advance();
      str += this.advance();
      let hexDigits = '';
      while (this.peekChar() !== undefined && isHexDigit(this.peekChar())) {
        hexDigits += this.advance();
      }
      if (hexDigits.length === 0) {
        this.fail('invalid hex number literal', startLine, startCol);
      }
      return parseInt(str + hexDigits, 16);
    }
    let sawDigits = false;
    while (this.peekChar() !== undefined && isDigit(this.peekChar())) {
      str += this.advance();
      sawDigits = true;
    }
    if (this.peekChar() === '.') {
      str += this.advance();
      while (this.peekChar() !== undefined && isDigit(this.peekChar())) {
        str += this.advance();
        sawDigits = true;
      }
    }
    if (!sawDigits) {
      this.fail('invalid number literal', startLine, startCol);
    }
    if (this.peekChar() === 'e' || this.peekChar() === 'E') {
      str += this.advance();
      if (this.peekChar() === '+' || this.peekChar() === '-') {
        str += this.advance();
      }
      if (!isDigit(this.peekChar())) {
        this.fail('invalid number literal (bad exponent)', startLine, startCol);
      }
      while (this.peekChar() !== undefined && isDigit(this.peekChar())) {
        str += this.advance();
      }
    }
    const num = Number(str);
    if (Number.isNaN(num)) {
      this.fail(`invalid number literal '${str}'`, startLine, startCol);
    }
    return num;
  }

  readIdent() {
    let str = '';
    while (this.peekChar() !== undefined && isIdentPart(this.peekChar())) {
      str += this.advance();
    }
    return str;
  }

  nextToken() {
    this.skipWhitespaceAndComments();
    const line = this.line;
    const col = this.col;
    const ch = this.peekChar();
    if (ch === undefined) {
      return { type: 'eof', value: undefined, line, col };
    }
    if (PUNCTUATION.has(ch)) {
      this.advance();
      return { type: ch, value: ch, line, col };
    }
    if (ch === '"' || ch === "'") {
      const value = this.readString(ch);
      return { type: 'string', value, line, col };
    }
    const next = this.peekChar(1);
    if (
      isDigit(ch) ||
      ((ch === '+' || ch === '-') && next !== undefined && isDigit(next)) ||
      (ch === '.' && next !== undefined && isDigit(next))
    ) {
      const value = this.readNumber();
      return { type: 'number', value, line, col };
    }
    if (isIdentStart(ch)) {
      const value = this.readIdent();
      return { type: 'ident', value, line, col };
    }
    this.fail(`unexpected character '${ch}'`, line, col);
    return undefined; // unreachable, keeps linters happy
  }
}

function describeToken(token) {
  switch (token.type) {
    case 'eof':
      return 'end of input';
    case 'string':
      return 'string literal';
    case 'number':
      return 'number literal';
    case 'ident':
      return `identifier '${token.value}'`;
    default:
      return `'${token.type}'`;
  }
}

class Parser {
  constructor(tokenizer) {
    this.tokenizer = tokenizer;
    this.current = tokenizer.nextToken();
  }

  advance() {
    const tok = this.current;
    this.current = this.tokenizer.nextToken();
    return tok;
  }

  fail(message, token = this.current) {
    this.tokenizer.fail(message, token.line, token.col);
  }

  expect(type) {
    if (this.current.type !== type) {
      this.fail(`expected '${type}' but found ${describeToken(this.current)}`);
    }
    return this.advance();
  }

  parseValue() {
    const token = this.current;
    switch (token.type) {
      case '{':
        return this.parseObject();
      case '[':
        return this.parseArray();
      case 'string':
        this.advance();
        return token.value;
      case 'number':
        this.advance();
        return token.value;
      case 'ident':
        if (token.value === 'true') {
          this.advance();
          return true;
        }
        if (token.value === 'false') {
          this.advance();
          return false;
        }
        if (token.value === 'null') {
          this.advance();
          return null;
        }
        this.fail(`unexpected identifier '${token.value}'`);
        return undefined;
      default:
        this.fail(`unexpected ${describeToken(token)}`);
        return undefined;
    }
  }

  parseKey() {
    const token = this.current;
    if (token.type === 'string' || token.type === 'ident') {
      this.advance();
      return token.value;
    }
    this.fail(`expected object key but found ${describeToken(token)}`);
    return undefined;
  }

  parseObject() {
    this.expect('{');
    const obj = {};
    if (this.current.type === '}') {
      this.advance();
      return obj;
    }
    for (;;) {
      const key = this.parseKey();
      this.expect(':');
      const value = this.parseValue();
      obj[key] = value;
      if (this.current.type === ',') {
        this.advance();
        if (this.current.type === '}') {
          break; // trailing comma
        }
        continue;
      }
      break;
    }
    this.expect('}');
    return obj;
  }

  parseArray() {
    this.expect('[');
    const arr = [];
    if (this.current.type === ']') {
      this.advance();
      return arr;
    }
    for (;;) {
      const value = this.parseValue();
      arr.push(value);
      if (this.current.type === ',') {
        this.advance();
        if (this.current.type === ']') {
          break; // trailing comma
        }
        continue;
      }
      break;
    }
    this.expect(']');
    return arr;
  }

  expectEnd() {
    if (this.current.type !== 'eof') {
      this.fail(`unexpected trailing ${describeToken(this.current)}`);
    }
  }
}

/**
 * Parse a JSON5-ish document into a plain JS value.
 *
 * @param {string} text - source text to parse.
 * @param {string} [filePath] - included in error messages when the input
 *   came from a file, so validator output can point straight at it.
 * @returns {*} the parsed value (object/array/string/number/boolean/null).
 */
export function parseJson5(text, filePath) {
  if (typeof text !== 'string') {
    throw new TypeError('parseJson5: text must be a string');
  }
  const tokenizer = new Tokenizer(text, filePath);
  const parser = new Parser(tokenizer);
  const value = parser.parseValue();
  parser.expectEnd();
  return value;
}

export { Json5SyntaxError };
