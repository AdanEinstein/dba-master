import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlsqlSource, alterCompileSql } from "./plsql-source.js";

test("parsePlsqlSource quebra spec + body separados por /", () => {
  const src =
    "-- cabeçalho\nCREATE OR REPLACE PACKAGE pkg_x AS\n  PROCEDURE p;\nEND;\n/\n" +
    'CREATE OR REPLACE EDITIONABLE PACKAGE BODY app."Pkg_X" AS\n  PROCEDURE p IS BEGIN NULL; END;\nEND;\r\n/\r\n';
  const units = parsePlsqlSource(src);
  assert.equal(units.length, 2);
  assert.deepEqual(
    units.map(({ type, owner, name }) => ({ type, owner, name })),
    [
      { type: "PACKAGE", owner: undefined, name: "PKG_X" },
      { type: "PACKAGE BODY", owner: "APP", name: "Pkg_X" },
    ],
  );
  assert.ok(units[0].sql.startsWith("CREATE OR REPLACE PACKAGE"));
  assert.ok(units[0].sql.endsWith("END;"));
});

test("parsePlsqlSource tira ; final só de VIEW", () => {
  const [v] = parsePlsqlSource("create or replace force view v_a as select 1 x from dual;");
  assert.equal(v.type, "VIEW");
  assert.equal(v.name, "V_A");
  assert.ok(!v.sql.endsWith(";"));
  const [f] = parsePlsqlSource("CREATE FUNCTION f RETURN NUMBER IS BEGIN RETURN 1; END;");
  assert.equal(f.type, "FUNCTION");
  assert.ok(f.sql.endsWith("END;"));
});

test("parsePlsqlSource rejeita unidade sem CREATE", () => {
  assert.throws(() => parsePlsqlSource("BEGIN NULL; END;"), /cabeçalho CREATE/);
  assert.throws(() => parsePlsqlSource("  \n/\n"), /vazio/);
});

test("alterCompileSql por tipo", () => {
  assert.equal(alterCompileSql("PACKAGE", "APP", "PKG"), 'ALTER PACKAGE "APP"."PKG" COMPILE');
  assert.equal(alterCompileSql("package  body", "APP", "PKG"), 'ALTER PACKAGE "APP"."PKG" COMPILE BODY');
  assert.equal(alterCompileSql("TYPE BODY", "APP", "T"), 'ALTER TYPE "APP"."T" COMPILE BODY');
  assert.equal(alterCompileSql("MATERIALIZED VIEW", "APP", "MV"), 'ALTER MATERIALIZED VIEW "APP"."MV" COMPILE');
  assert.throws(() => alterCompileSql("TABLE", "APP", "T"), /não é compilável/);
  assert.throws(() => alterCompileSql("PACKAGE", "APP", 'X" COMPILE; DROP'), /inválido/);
});
