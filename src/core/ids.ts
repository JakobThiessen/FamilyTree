/** Zähler für fortlaufende IDs wie `p_12`: nächste freie Nummer nach der größten vorhandenen. */
export class IdSource {
  private next: number;
  constructor(
    private readonly prefix: string,
    existing: Iterable<string>,
  ) {
    let max = 0;
    const re = new RegExp(`^${prefix}_(\\d+)$`);
    for (const id of existing) {
      const m = re.exec(id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    this.next = max + 1;
  }
  take(): string {
    return `${this.prefix}_${this.next++}`;
  }
}
