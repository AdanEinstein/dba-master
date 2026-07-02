import { test } from "node:test";
import assert from "node:assert/strict";
import { PgProvider } from "./pg-provider.js";

// Só exercita a lógica pura de mapeamento de tipos — sem I/O de banco.
const p = new PgProvider(
  { engine: "postgres", user: "x", connectString: "postgresql://localhost/x" },
  { connections: {}, cacheDir: "" },
);

test("typeToTs mapeia tipos Postgres", () => {
  assert.equal(p.typeToTs("integer"), "number");
  assert.equal(p.typeToTs("smallint"), "number");
  assert.equal(p.typeToTs("double precision"), "number");
  // bigint/numeric voltam como string no node-postgres (preserva precisão)
  assert.equal(p.typeToTs("bigint"), "string");
  assert.equal(p.typeToTs("numeric"), "string");
  assert.equal(p.typeToTs("character varying"), "string");
  assert.equal(p.typeToTs("text"), "string");
  assert.equal(p.typeToTs("uuid"), "string");
  assert.equal(p.typeToTs("boolean"), "boolean");
  assert.equal(p.typeToTs("timestamp without time zone"), "Date");
  assert.equal(p.typeToTs("date"), "Date");
  assert.equal(p.typeToTs("bytea"), "Buffer");
  assert.equal(p.typeToTs("jsonb"), "unknown");
  assert.equal(p.typeToTs("ARRAY"), "unknown");
});
