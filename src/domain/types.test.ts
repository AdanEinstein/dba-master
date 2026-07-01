import assert from "node:assert/strict";
import { generateInterface, isWriteStatement, type ColumnInfo } from "./types.js";
import { readCachedDdlTime } from "../infrastructure/schema-cache.js";
import { OracleProvider } from "../infrastructure/oracle/oracle-provider.js";

// Mapeamento de tipos do adapter Oracle (não instancia conexão — typeToTs é puro)
const oracle = new OracleProvider({} as never, {} as never);
assert.equal(oracle.typeToTs("VARCHAR2"), "string");
assert.equal(oracle.typeToTs("NUMBER"), "number");
assert.equal(oracle.typeToTs("DATE"), "Date");
assert.equal(oracle.typeToTs("TIMESTAMP(6)"), "Date");
assert.equal(oracle.typeToTs("CLOB"), "string");
assert.equal(oracle.typeToTs("BLOB"), "Buffer");
assert.equal(oracle.typeToTs("RAW"), "Buffer");
assert.equal(oracle.typeToTs("SDO_GEOMETRY"), "unknown");
assert.deepEqual(oracle.capabilities, { packages: true, scheduledJobs: true });

// Geração de interface: nullable vira opcional + | null; nome inválido é quotado
const cols: ColumnInfo[] = [
  { name: "ID", dataType: "NUMBER", nullable: false },
  { name: "NOME", dataType: "VARCHAR2", nullable: true },
  { name: "2ND_COL", dataType: "DATE", nullable: false },
];
const iface = generateInterface("HR", "EMPLOYEES", cols, oracle.typeToTs.bind(oracle), "2026-07-01T00:00:00.000Z");
assert.match(iface, /export interface Employees {/);
assert.match(iface, /\bID: number;/);
assert.match(iface, /\bNOME\?: string \| null;/);
assert.match(iface, /"2ND_COL": Date;/);
assert.match(iface, /last_ddl: 2026-07-01T00:00:00\.000Z/);

// readCachedDdlTime lê o header e ignora "unknown"
assert.equal(readCachedDdlTime(iface), "2026-07-01T00:00:00.000Z");
assert.equal(readCachedDdlTime("// last_ddl: unknown\n"), undefined);
assert.equal(readCachedDdlTime("sem header"), undefined);

// Guarda de escrita: SELECT/WITH/EXPLAIN são leitura; resto é escrita
assert.equal(isWriteStatement("SELECT * FROM t"), false);
assert.equal(isWriteStatement("  select 1 from dual"), false);
assert.equal(isWriteStatement("WITH x AS (SELECT 1 FROM dual) SELECT * FROM x"), false);
assert.equal(isWriteStatement("-- comentário\nSELECT 1 FROM dual"), false);
assert.equal(isWriteStatement("/* bloco */ SELECT 1 FROM dual"), false);
assert.equal(isWriteStatement("INSERT INTO t VALUES (1)"), true);
assert.equal(isWriteStatement("UPDATE t SET a=1"), true);
assert.equal(isWriteStatement("DELETE FROM t"), true);
assert.equal(isWriteStatement("DROP TABLE t"), true);
assert.equal(isWriteStatement("MERGE INTO t ..."), true);
assert.equal(isWriteStatement("BEGIN foo(); END;"), true);

console.log("ok — domain/types.test.ts passou");
