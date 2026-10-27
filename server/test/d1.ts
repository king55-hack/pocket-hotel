import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

// A tiny stand-in for Cloudflare D1 built on Node's SQLite, so the API runs in-process in tests.
class Stmt {
  args: unknown[] = [];
  constructor(private db: DatabaseSync, private sql: string) {}
  bind(...a: unknown[]) { this.args = a; return this; }
  private st() { return this.db.prepare(this.sql); }
  async first<T = any>(): Promise<T | null> { return (this.st().get(...(this.args as any[])) as T) ?? null; }
  async all<T = any>() { return { results: this.st().all(...(this.args as any[])) as T[] }; }
  async run() { const r = this.st().run(...(this.args as any[])); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; }
}

export function makeDB() {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(dir).sort()) db.exec(readFileSync(new URL(f, dir), "utf8"));
  return {
    prepare: (sql: string) => new Stmt(db, sql),
    async batch(stmts: Stmt[]) {
      db.exec("BEGIN");
      try { const out = []; for (const s of stmts) out.push(await s.run()); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  } as any as D1Database;
}
