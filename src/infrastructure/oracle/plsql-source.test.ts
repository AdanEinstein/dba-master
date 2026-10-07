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

test("parsePlsqlSource aceita script SQL*Plus misto sem lançar", () => {
  const src = [
    "SET DEFINE OFF",
    "PROMPT criando pkg",
    "ALTER SESSION SET CURRENT_SCHEMA = APP;",
    "GRANT SELECT ON t TO r; -- leitura",
    "CREATE OR REPLACE",
    "PACKAGE pkg AS",
    "  c CONSTANT VARCHAR2(10) := 'ação;';",
    "END;",
    "/",
    "SHOW ERRORS",
    "BEGIN",
    "  NULL;",
    "END;",
    "/",
    "EXEC dbms_output.put_line('x');",
    "create view v as",
    "  select 1 x from dual;",
    "EXIT",
  ].join("\r\n");
  const units = parsePlsqlSource(src);
  assert.deepEqual(
    units.map(({ kind, type }) => `${kind}:${type}`),
    ["skipped:SQLPLUS", "skipped:SQLPLUS", "sql:SQL", "sql:SQL", "plsql:PACKAGE", "skipped:SQLPLUS", "sql:SQL", "sql:SQL", "plsql:VIEW", "skipped:SQLPLUS"],
  );
  assert.equal(units[2].sql, "ALTER SESSION SET CURRENT_SCHEMA = APP");
  assert.ok(units[4].sql.includes("'ação;'") && units[4].sql.endsWith("END;"));
  assert.equal(units[6].sql, "BEGIN\n  NULL;\nEND;");
  assert.equal(units[7].sql, "BEGIN dbms_output.put_line('x'); END;");
  assert.ok(!units[8].sql.endsWith(";"));
  assert.deepEqual(parsePlsqlSource("  \n/\n"), []);
});

test("alterCompileSql por tipo", () => {
  assert.equal(alterCompileSql("PACKAGE", "APP", "PKG"), 'ALTER PACKAGE "APP"."PKG" COMPILE');
  assert.equal(alterCompileSql("package  body", "APP", "PKG"), 'ALTER PACKAGE "APP"."PKG" COMPILE BODY');
  assert.equal(alterCompileSql("TYPE BODY", "APP", "T"), 'ALTER TYPE "APP"."T" COMPILE BODY');
  assert.equal(alterCompileSql("MATERIALIZED VIEW", "APP", "MV"), 'ALTER MATERIALIZED VIEW "APP"."MV" COMPILE');
  assert.throws(() => alterCompileSql("TABLE", "APP", "T"), /não é compilável/);
  assert.throws(() => alterCompileSql("PACKAGE", "APP", 'X" COMPILE; DROP'), /inválido/);
});
