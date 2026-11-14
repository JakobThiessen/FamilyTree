/**
 * Zeichensatz-Erkennung und Dekodierung für GEDCOM-Dateien (UTF-8, UTF-16, ANSEL, ISO-8859-1/ANSI).
 * Reines TypeScript; nutzt nur `TextDecoder` (in Browser, Worker und Node vorhanden).
 */

export type GedcomCharset = "utf-8" | "utf-16le" | "utf-16be" | "ansel" | "windows-1252";

export interface DecodedGedcom {
  text: string;
  charset: GedcomCharset;
}

/** ANSEL-Zeichen ohne Kombinationswirkung (Hexwert -> Unicode). */
const ANSEL_BASE: Record<number, string> = {
  0xa1: "Ł", 0xa2: "Ø", 0xa3: "Đ", 0xa4: "Þ", 0xa5: "Æ", 0xa6: "Œ", 0xa7: "ʹ", 0xa8: "·",
  0xa9: "♭", 0xaa: "®", 0xab: "±", 0xac: "Ơ", 0xad: "Ư", 0xae: "ʼ", 0xb0: "ʻ", 0xb1: "ł",
  0xb2: "ø", 0xb3: "đ", 0xb4: "þ", 0xb5: "æ", 0xb6: "œ", 0xb7: "ʺ", 0xb8: "ı", 0xb9: "£",
  0xba: "ð", 0xbc: "ơ", 0xbd: "ư", 0xc0: "°", 0xc1: "ℓ", 0xc2: "℗", 0xc3: "©", 0xc4: "♯",
  0xc5: "¿", 0xc6: "¡", 0xcf: "ß",
};

/** ANSEL-Akzente (stehen in ANSEL VOR dem Buchstaben) -> Unicode-Combining-Zeichen (stehen danach). */
const ANSEL_COMBINING: Record<number, string> = {
  0xe0: "̉", 0xe1: "̀", 0xe2: "́", 0xe3: "̂", 0xe4: "̃", 0xe5: "̄",
  0xe6: "̆", 0xe7: "̇", 0xe8: "̈", 0xe9: "̌", 0xea: "̊", 0xee: "̋",
  0xf0: "̧", 0xf1: "̨", 0xf2: "̣", 0xf3: "̤", 0xf4: "̥", 0xf6: "̲",
  0xf9: "̮", 0xfe: "̓",
};

/** Dekodiert ANSEL-Bytes. Akzent + Buchstabe werden zu einem zusammengesetzten Zeichen (NFC). */
export function decodeAnsel(bytes: Uint8Array): string {
  let out = "";
  let marks = "";
  for (const b of bytes) {
    const mark = ANSEL_COMBINING[b];
    if (mark !== undefined) {
      marks += mark;
      continue;
    }
    let ch: string;
    if (b < 0x80) ch = String.fromCharCode(b);
    else ch = ANSEL_BASE[b] ?? (b <= 0x9f ? "" : "�");
    // Akzente gehören zum folgenden Zeichen; vor einem Zeilenumbruch werden sie verworfen.
    if (ch === "\n" || ch === "\r") {
      out += ch;
      marks = "";
    } else if (ch !== "") {
      out += ch + marks;
      marks = "";
    }
  }
  return out.normalize("NFC");
}

/** Liest `1 CHAR xyz` aus dem Kopf (die Bytes werden dafür als Latin-1 gelesen, ASCII reicht). */
function sniffCharsetName(bytes: Uint8Array): string | null {
  const head = Array.from(bytes.subarray(0, 4096), (b) => String.fromCharCode(b)).join("");
  const m = head.match(/^\s*1\s+CHAR\s+([^\s]+)/im);
  return m?.[1]?.toUpperCase() ?? null;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Erkennt den Zeichensatz (BOM, sonst `CHAR`-Zeile im Kopf) und liefert den Text. */
export function decodeGedcom(bytes: Uint8Array): DecodedGedcom {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: stripBom(new TextDecoder("utf-8").decode(bytes)), charset: "utf-8" };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: stripBom(new TextDecoder("utf-16le").decode(bytes)), charset: "utf-16le" };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: stripBom(new TextDecoder("utf-16be").decode(bytes)), charset: "utf-16be" };
  }
  // UTF-16 ohne BOM: Das erste Zeichen ist ASCII ("0 HEAD"), also steht ein Nullbyte an einer Stelle.
  if (bytes.length >= 2 && bytes[0] !== 0 && bytes[1] === 0) {
    return { text: new TextDecoder("utf-16le").decode(bytes), charset: "utf-16le" };
  }
  if (bytes.length >= 2 && bytes[0] === 0 && bytes[1] !== 0) {
    return { text: new TextDecoder("utf-16be").decode(bytes), charset: "utf-16be" };
  }

  const name = sniffCharsetName(bytes);
  if (name === "ANSEL") return { text: decodeAnsel(bytes), charset: "ansel" };
  if (name === "UTF-8" || name === "UTF8") {
    return { text: new TextDecoder("utf-8").decode(bytes), charset: "utf-8" };
  }
  if (name === "UNICODE") return { text: new TextDecoder("utf-16le").decode(bytes), charset: "utf-16le" };
  if (name !== null) {
    // ANSI, ASCII, ISO-8859-1, LATIN1, IBM-Zeichensätze ... -> Windows-1252 ist die übliche Näherung.
    return { text: new TextDecoder("windows-1252").decode(bytes), charset: "windows-1252" };
  }
  // Keine Angabe: gültiges UTF-8 annehmen, sonst Windows-1252.
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), charset: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), charset: "windows-1252" };
  }
}
