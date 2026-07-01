import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateInterfaces } from "./schema-compiler.js";
import type { DatabaseProvider } from "../src/domain/database-provider.js";
import type { TableRef, TableSchema, ViewRef, ViewSchema, ColumnInfo, Relationships } from "../src/domain/types.js";

// Provider stub: 2 tabelas, 1 view. Só os métodos usados por generateInterfaces.
const cols: ColumnInfo[] = [{ name: "ID", dataType: "NUMBER", nullable: false }];
const fk = { constraintName: "FK1", columns: ["DEPT_ID"], referencedOwner: "HR", referencedTable: "DEPARTMENTS", referencedColumns: ["ID"] };
const stub = {
  typeToTs: (t: string) => (t === "NUMBER" ? "number" : "string"),
  listTables: async (): Promise<TableRef[]> => [
    { owner: "HR", tableName: "EMPLOYEES", numRows: 1 },
    { owner: "HR", tableName: "DEPARTMENTS", numRows: 1 },
  ],
  listDdlTimes: async () => [
    { owner: "HR", name: "EMPLOYEES", lastDdlTime: "2024-01-01T12:00:00Z" },
    { owner: "HR", name: "DEPARTMENTS", lastDdlTime: "2024-01-01T12:00:00Z" },
    { owner: "HR", name: "EMP_VIEW", lastDdlTime: "2024-01-01T12:00:00Z" },
  ],
  describeTable: async (table: string, schema?: string): Promise<TableSchema> => {
    (stub as any).describeTableCalls = ((stub as any).describeTableCalls || 0) + 1;
    return {
      owner: schema ?? "HR", tableName: table, columns: cols, primaryKey: ["ID"],
      foreignKeys: table === "EMPLOYEES" ? [fk] : [], indexes: [], checkConstraints: [], comment: null,
      lastDdlTime: "2024-01-01T12:00:00Z"
    };
  },
  getRelationships: async (table: string, schema?: string): Promise<Relationships> => ({
    owner: schema ?? "HR", tableName: table, outgoing: [], incoming: [],
  }),
  listViews: async (): Promise<ViewRef[]> => [{ owner: "HR", viewName: "EMP_VIEW" }],
  describeView: async (view: string, schema?: string): Promise<ViewSchema> => {
    (stub as any).describeViewCalls = ((stub as any).describeViewCalls || 0) + 1;
    return {
      owner: schema ?? "HR", viewName: view, columns: cols, text: "SELECT 1 FROM dual", comment: null,
      lastDdlTime: "2024-01-01T12:00:00Z"
    };
  },
} as unknown as DatabaseProvider;

const dir = mkdtempSync(join(tmpdir(), "dba-compile-"));

// tabelas + views por padrão
const r = await generateInterfaces(stub, dir);
assert.equal(r.tables, 2);
assert.equal(r.views, 1);
assert.equal(r.errors.length, 0);
assert.ok(existsSync(join(dir, "HR", "EMPLOYEES.ts")));
assert.ok(existsSync(join(dir, "HR", "EMP_VIEW.ts")));
const empSrc = readFileSync(join(dir, "HR", "EMPLOYEES.ts"), "utf8");
assert.match(empSrc, /export interface Employees {/);
assert.match(empSrc, /\/\/ kind: table/);
assert.match(empSrc, /FK → HR\.DEPARTMENTS/);
assert.match(readFileSync(join(dir, "HR", "EMP_VIEW.ts"), "utf8"), /\/\/ kind: view/);

// includeViews:false pula views
const dir2 = mkdtempSync(join(tmpdir(), "dba-compile-"));
const r2 = await generateInterfaces(stub, dir2, { includeViews: false });
assert.equal(r2.tables, 2);
assert.equal(r2.views, 0);
assert.ok(!existsSync(join(dir2, "HR", "EMP_VIEW.ts")));

// Teste incremental (fast-path): segunda chamada com mesmos ddl times não deve chamar describe
const describeTableCallsBefore = (stub as any).describeTableCalls || 0;
const describeViewCallsBefore = (stub as any).describeViewCalls || 0;

const r3 = await generateInterfaces(stub, dir); // usando o primeiro diretório (dir) que já tem cache
assert.equal(r3.tables, 2);
assert.equal(r3.views, 1);
assert.equal((stub as any).describeTableCalls, describeTableCallsBefore, "should have skipped describeTable");
assert.equal((stub as any).describeViewCalls, describeViewCallsBefore, "should have skipped describeView");

// Teste com force:true (mesmo com cache bate, deve recriar e chamar describe)
const r4 = await generateInterfaces(stub, dir, { force: true });
assert.equal(r4.tables, 2);
assert.equal(r4.views, 1);
assert.ok((stub as any).describeTableCalls > describeTableCallsBefore, "should have called describeTable");
assert.ok((stub as any).describeViewCalls > describeViewCallsBefore, "should have called describeView");

console.log("ok — schema-compiler.test.ts passou");
