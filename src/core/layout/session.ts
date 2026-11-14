/**
 * LayoutSession: hält Graph und letztes Ergebnis, damit neue Chunks vorhandene Karten nicht verschieben.
 * Reines TypeScript; läuft im Worker (siehe src/workers/layoutWorker.ts) und in Tests.
 */
import { FamilyGraph } from "../graph";
import type { TreeData, ViewRequest } from "../types";
import { layoutView } from "./layout";
import type { LayoutOptions, LayoutResult } from "./types";

export class LayoutSession {
  private graph: FamilyGraph;
  private last: LayoutResult | undefined;

  constructor(
    data: Pick<TreeData, "persons" | "unions">,
    private readonly options: Partial<LayoutOptions> = {},
  ) {
    this.graph = new FamilyGraph(data);
  }

  /**
   * Ersetzt die Daten (z. B. nach dem Nachladen weiterer Personen). Das letzte Ergebnis bleibt erhalten,
   * damit schon platzierte Karten ihre Position behalten.
   */
  setData(data: Pick<TreeData, "persons" | "unions">): void {
    this.graph = new FamilyGraph(data);
  }

  /** Vergisst die bisherigen Positionen (nächstes Layout beginnt neu). */
  reset(): void {
    this.last = undefined;
  }

  /**
   * Berechnet das Layout. Gleicher Fokus und Modus wie zuvor = inkrementell (vorhandene Karten bleiben stehen,
   * `added` nennt die neuen). Anderer Fokus oder Modus = neues Layout.
   */
  layout(request: ViewRequest): LayoutResult {
    const prev = this.last;
    const incremental = prev !== undefined && prev.request.focusId === request.focusId && prev.request.mode === request.mode;
    const result = layoutView(this.graph, request, this.options, incremental ? prev : undefined);
    this.last = result;
    return result;
  }
}
