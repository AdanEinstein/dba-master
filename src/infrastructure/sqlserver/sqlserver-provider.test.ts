import { test } from "node:test";
import assert from "node:assert/strict";
import { SqlServerProvider, formatType, quoteIdent } from "./sqlserver-provider.js";
import { parseSqlServerUrl } from "./sqlserver-connection.js";
import { parseEndpoint, rewriteConnectString } from "../tunnel/index.js";

// Só lógica pura (tipos, DDL, URL, túnel) — sem I/O de banco.
const p = new SqlServerProvider(
  { engine: "sqlserver", user: "", connectString: "sqlserver://u:p@localhost/x" },
  { connections: {}, cacheDir: "" },
);

test("typeToTs mapeia tipos SQL Server", () => {
  assert.equal(p.typeToTs("int"), "number");
  assert.equal(p.typeToTs("decimal"), "number");
  assert.equal(p.typeToTs("bigint"), "string"); // tedious devolve string (precisão)
  assert.equal(p.typeToTs("nvarchar"), "string");
  assert.equal(p.typeToTs("uniqueidentifier"), "string");
  assert.equal(p.typeToTs("bit"), "boolean");
  assert.equal(p.typeToTs("datetime2"), "Date");
  assert.equal(p.typeToTs("timestamp"), "Buffer"); // rowversion, não data
  assert.equal(p.typeToTs("varbinary"), "Buffer");
  assert.equal(p.typeToTs("geography"), "unknown");
});

test("formatType e quoteIdent", () => {
  assert.equal(formatType({ data_type: "nvarchar", max_length: 100, precision: 0, scale: 0 }), "nvarchar(50)");
  assert.equal(formatType({ data_type: "varchar", max_length: -1, precision: 0, scale: 0 }), "varchar(MAX)");
  assert.equal(formatType({ data_type: "decimal", max_length: 9, precision: 18, scale: 2 }), "decimal(18,2)");
  assert.equal(formatType({ data_type: "int", max_length: 4, precision: 10, scale: 0 }), "int");
  assert.equal(quoteIdent("a]b"), "[a]]b]");
});

test("parseSqlServerUrl decodifica creds e lê flags", () => {
  const c = parseSqlServerUrl("sqlserver://sa:p%40ss@db.internal:1444/app?trustServerCertificate=true", { user: "" });
  assert.equal(c.server, "db.internal");
  assert.equal(c.port, 1444);
  assert.equal(c.database, "app");
  assert.equal(c.user, "sa");
  assert.equal(c.password, "p@ss");
  assert.equal(c.options?.encrypt, true);
  assert.equal(c.options?.trustServerCertificate, true);
  // sem porta → 1433; creds ausentes na URL → fallback do cfg
  const d = parseSqlServerUrl("sqlserver://db/app", { user: "u", password: "w" });
  assert.equal(d.port, 1433);
  assert.equal(d.user, "u");
});

test("túnel: porta default 1433 e rewrite preservam o resto da URL", () => {
  assert.deepEqual(parseEndpoint("sqlserver", "sqlserver://u:p@db.internal/app"), { host: "db.internal", port: 1433 });
  const u = new URL(rewriteConnectString("mssql", "sqlserver://u:p@db.internal:1433/app", { host: "127.0.0.1", port: 54021 }));
  assert.equal(u.hostname, "127.0.0.1");
  assert.equal(u.port, "54021");
  assert.equal(u.pathname, "/app");
});
