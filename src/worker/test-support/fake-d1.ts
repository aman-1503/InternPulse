/**
 * A real-SQLite-backed stand-in for the D1Database binding, used only by
 * tests. D1 IS SQLite, so this runs the actual migrations (not a hand-rolled
 * query matcher) via Node's built-in node:sqlite, giving tests real
 * constraint/JOIN/CHECK semantics instead of a fake that could silently
 * diverge from production behavior.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Resolved from the working directory rather than import.meta.url: the
// Workers global `URL` type (from generated worker-configuration.d.ts)
// conflicts with node:url's URL type under tsconfig.worker.json, and tests
// are always run from the project root (`npm test` / `vitest run`).
const MIGRATIONS = ["0001_init.sql", "0002_production_auth.sql"].map((name) =>
  join(process.cwd(), "migrations", name),
);

class FakeD1PreparedStatement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(this.db, this.sql, params);
  }

  async first<T>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...(this.params as never[]));
    return (row as T) ?? null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    const rows = this.db.prepare(this.sql).all(...(this.params as never[]));
    return { results: rows as T[] };
  }

  async run(): Promise<{ success: boolean }> {
    this.db.prepare(this.sql).run(...(this.params as never[]));
    return { success: true };
  }
}

export interface FakeD1 {
  prepare(sql: string): FakeD1PreparedStatement;
  batch(stmts: FakeD1PreparedStatement[]): Promise<Array<{ success: boolean }>>;
}

export function createTestD1(): FakeD1 {
  const db = new DatabaseSync(":memory:");
  for (const path of MIGRATIONS) {
    db.exec(readFileSync(path, "utf8"));
  }
  return {
    prepare(sql: string) {
      return new FakeD1PreparedStatement(db, sql);
    },
    async batch(stmts) {
      const out: Array<{ success: boolean }> = [];
      for (const stmt of stmts) out.push(await stmt.run());
      return out;
    },
  };
}
