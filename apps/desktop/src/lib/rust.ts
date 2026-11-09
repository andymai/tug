// Rust's trim takes White_Space; JavaScript's also takes U+FEFF and leaves U+0085.
export function trimmed(text: string): string {
  return text.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
}

const ESCAPES: Readonly<Record<string, string>> = { "\0": "\\0", "\t": "\\t", "\r": "\\r", "\n": "\\n", '"': '\\"', "\\": "\\\\" };
// Rust's is_printable and is_grapheme_extended, from this engine's Unicode tables.
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}\p{Grapheme_Extend}]/u;

// Tug's messages quote a value with Rust's {:?}, which differs from JSON's quotes.
export function quoted(text: string): string {
  let out = "";
  for (const char of text) {
    const escape = ESCAPES[char];
    if (escape !== undefined) out += escape;
    else if (char !== " " && UNPRINTABLE.test(char)) out += `\\u{${(char.codePointAt(0) ?? 0).toString(16)}}`;
    else out += char;
  }
  return `"${out}"`;
}

const points = (text: string) => Array.from(text, (char) => char.codePointAt(0) ?? 0);

// A BTreeMap's order: Rust compares UTF-8 bytes, which follow code points, and
// JavaScript's sort compares UTF-16 units, which don't past U+FFFF.
export function byCodePoint(a: string, b: string): number {
  const left = points(a);
  const right = points(b);
  const at = left.findIndex((point, index) => point !== right[index]);
  if (at < 0) return left.length - right.length;
  return (left[at] ?? 0) - (right[at] ?? -1);
}
