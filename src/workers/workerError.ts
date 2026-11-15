/**
 * Fehler der Worker-Brücken mit Kennung, damit die Oberfläche sie übersetzen kann (D37).
 * Die Nachricht bleibt deutsch (Rückfall); `code` und `params` gehören zu `error.<code>` in `src/ui/locales`.
 */
export class CodedError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(message);
    this.name = "CodedError";
  }
}

/** Code und Parameter eines beliebigen gefangenen Fehlers (falls er welche trägt). */
export function errorCode(err: unknown): { code?: string; params?: Record<string, string | number> } {
  if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string") {
    const e = err as { code: string; params?: Record<string, string | number> };
    return { code: e.code, params: e.params };
  }
  return {};
}
