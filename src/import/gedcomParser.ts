/**
 * Zeilenparser für GEDCOM: Text -> Baum aus Knoten (Level, Xref, Tag, Wert, Kinder).
 * Kennt noch keine Bedeutung der Tags (das macht `gedcomImport.ts`).
 */

export interface GedcomNode {
  level: number;
  /** Kennung des Datensatzes ohne @, z. B. "I1" (nur bei Level 0) */
  xref?: string;
  tag: string;
  value: string;
  children: GedcomNode[];
  /** Zeilennummer (ab 1) für Fehlermeldungen */
  line: number;
}

export interface ParseWarning {
  line: number;
  message: string;
}

const LINE_RE = /^\s*(\d+)\s+(?:@([^@\s]+)@\s+)?([^\s]+)(?: (.*))?$/;

/** Liest GEDCOM-Text. Fehlerhafte Zeilen werden übersprungen und als Warnung gemeldet. */
export function parseGedcomText(text: string): { records: GedcomNode[]; warnings: ParseWarning[] } {
  const records: GedcomNode[] = [];
  const warnings: ParseWarning[] = [];
  const stack: GedcomNode[] = [];
  const lines = text.split(/\r\n|\n|\r/);

  lines.forEach((raw, i) => {
    const line = i + 1;
    if (raw.trim() === "") return;
    const m = raw.match(LINE_RE);
    if (!m) {
      warnings.push({ line, message: `Zeile nicht lesbar: "${raw.slice(0, 40)}"` });
      return;
    }
    const level = Number(m[1]);
    const tag = (m[3] ?? "").toUpperCase();
    const value = m[4] ?? "";

    if (level > 0 && !stack[level - 1]) {
      warnings.push({ line, message: `Level ${level} ohne passenden übergeordneten Eintrag, Zeile übersprungen.` });
      return;
    }

    // Fortsetzungszeilen werden in den Wert des übergeordneten Eintrags eingearbeitet.
    if (level > 0 && (tag === "CONC" || tag === "CONT")) {
      const parent = stack[level - 1]!;
      parent.value += (tag === "CONT" ? "\n" : "") + value;
      return;
    }

    const node: GedcomNode = { level, tag, value, children: [], line };
    if (m[2] !== undefined) node.xref = m[2];
    if (level === 0) records.push(node);
    else stack[level - 1]!.children.push(node);
    stack.length = level;
    stack[level] = node;
  });

  return { records, warnings };
}

/** Erster Kindknoten mit diesem Tag. */
export function child(node: GedcomNode, tag: string): GedcomNode | undefined {
  return node.children.find((c) => c.tag === tag);
}

/** Alle Kindknoten mit diesem Tag. */
export function childrenOf(node: GedcomNode, tag: string): GedcomNode[] {
  return node.children.filter((c) => c.tag === tag);
}

/** Wert des ersten Kindknotens mit diesem Tag (getrimmt), sonst `undefined`. */
export function childValue(node: GedcomNode, tag: string): string | undefined {
  const v = child(node, tag)?.value.trim();
  return v ? v : undefined;
}

/** Zeigerwert "@I1@" -> "I1"; `null`, wenn der Wert kein Zeiger ist. */
export function pointer(value: string): string | null {
  const m = value.trim().match(/^@([^@\s]+)@$/);
  return m?.[1] ?? null;
}
