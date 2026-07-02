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
  listDdlTimes: async () => [],
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
  getSchemaInventory: async () => ({
    columns: [
      { owner: "HR", table: "EMPLOYEES", column: "ID", dataType: "NUMBER" },
      { owner: "HR", table: "EMPLOYEES", column: "DEPARTMENT_ID", dataType: "NUMBER" },
      { owner: "HR", table: "DEPARTMENTS", column: "ID", dataType: "NUMBER" },
    ],
    primaryKeys: [
      { owner: "HR", table: "EMPLOYEES", column: "ID" },
      { owner: "HR", table: "DEPARTMENTS", column: "ID" },
    ],
    declaredFkColumns: [],
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
const r = await generateInterfaces(stub, dir, "test_conn");
assert.equal(r.tables, 2);
assert.equal(r.views, 1);
assert.equal(r.errors.length, 0);
assert.ok(existsSync(join(dir, "test_conn", "HR", "EMPLOYEES.ts")));
assert.ok(existsSync(join(dir, "test_conn", "HR", "EMP_VIEW.ts")));
const empSrc = readFileSync(join(dir, "test_conn", "HR", "EMPLOYEES.ts"), "utf8");
assert.match(empSrc, /export interface Employees {/);
assert.match(empSrc, /\/\/ hash: /);
assert.match(empSrc, /FK → HR\.DEPARTMENTS/);
// FK implícita inferida (DEPARTMENT_ID → DEPARTMENTS.ID) refletida no cache.
assert.match(empSrc, /FK implícita \(inferida\) → HR\.DEPARTMENTS\.ID/);
assert.match(readFileSync(join(dir, "test_conn", "HR", "EMP_VIEW.ts"), "utf8"), /\/\/ kind: view/);

// includeViews:false pula views
const dir2 = mkdtempSync(join(tmpdir(), "dba-compile-"));
const r2 = await generateInterfaces(stub, dir2, "test_conn", { includeViews: false });
assert.equal(r2.tables, 2);
assert.equal(r2.views, 0);
assert.ok(!existsSync(join(dir2, "test_conn", "HR", "EMP_VIEW.ts")));

console.log("ok — schema-compiler.test.ts passou");
