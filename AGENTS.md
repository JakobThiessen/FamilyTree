# AGENTS.md

Die vollständigen Regeln stehen in [docs/AGENTS.md](docs/AGENTS.md). Bitte zuerst lesen, danach [docs/memory.md](docs/memory.md) und [docs/PLAN.md](docs/PLAN.md).

Kurzfassung:
- Pro Sitzung ein Meilenstein aus dem Plan, mit dem Nutzer abgestimmt.
- Nach der Arbeit: CHANGELOG, PLAN und memory.md aktualisieren (alle in `docs/`).
- `src/core` ist reines TypeScript. Jede Person nur einmal im Graphen, Beziehungen über Unions.
- Dokumente Deutsch, Code Englisch. Beispiele nur mit erfundenen Personen.
- Keine echten Familiendaten einchecken (`imports/` ist ignoriert). Kein Scraping.
