/**
 * LayoutSession: hält Graph und letztes Ergebnis, damit neue Chunks vorhandene Karten nicht verschieben.
 * Reines TypeScript; läuft im Worker (siehe src/workers/layoutWorker.ts) und in Tests.
 */
import { applyEdit } from "../edit";
import type { TreeChanges } from "../edit";
import { FamilyGraph } from "../graph";
import type { TreeData, ViewRequest } from "../types";
import { layoutView } from "./layout";
import type { LayoutOptions, LayoutResult } from "./types";

export class LayoutSession {
  private graph: FamilyGraph;
  private last: LayoutResult | undefined;
  private data: Pick<TreeData, "persons" | "unions">;

  constructor(
    data: Pick<TreeData, "persons" | "unions">,
    private readonly options: Partial<LayoutOptions> = {},
  ) {
    this.data = data;
    this.graph = new FamilyGraph(data);
  }

  /**
   * Ersetzt die Daten (z. B. nach dem Nachladen weiterer Personen). Das letzte Ergebnis bleibt erhalten,
   * damit schon platzierte Karten ihre Position behalten.
   */
  setData(data: Pick<TreeData, "persons" | "unions">): void {
    this.data = data;
    this.graph = new FamilyGraph(data);
  }

  /**
   * Führt geänderte Datensätze nach (Bearbeiten, M10): Der Worker bekommt nur die Änderungsliste statt den ganzen
   * Baum, denn das Kopieren von 50.000 Personen per `postMessage` kostete ca. 500 ms im UI-Thread.
   * Wirft, wenn die Liste nicht zum Stand passt; der Aufrufer schickt dann den ganzen Baum (`setData`).
   */
  applyChanges(changes: TreeChanges): void {
    const r = applyEdit({ version: 1, persons: this.data.persons, unions: this.data.unions, sources: [] }, { type: "patch", changes });
    if (!r.ok) throw new Error(r.reject.code);
    this.setData({ persons: r.data.persons, unions: r.data.unions });
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
