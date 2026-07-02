import assert from "node:assert/strict";
import { parseEndpoint, rewriteConnectString } from "./index.js";

const local = { host: "127.0.0.1", port: 54021 };

// Postgres: URL → host/port; rewrite troca só host:port, preserva user/pass/db.
assert.deepEqual(parseEndpoint("postgres", "postgresql://u:p@db.internal:5432/app"), {
  host: "db.internal",
  port: 5432,
});
assert.deepEqual(parseEndpoint("postgres", "postgresql://u:p@db.internal/app"), {
  host: "db.internal",
  port: 5432,
});
{
  const out = rewriteConnectString("postgres", "postgresql://u:p@db.internal:5432/app", local);
  const u = new URL(out);
  assert.equal(u.hostname, "127.0.0.1");
  assert.equal(u.port, "54021");
  assert.equal(u.username, "u");
  assert.equal(u.password, "p");
  assert.equal(u.pathname, "/app");
}

// Oracle EZConnect: host:port/service → host/port; rewrite preserva o service.
assert.deepEqual(parseEndpoint("oracle", "realdb.internal:1521/ORCLPDB"), {
  host: "realdb.internal",
  port: 1521,
});
assert.deepEqual(parseEndpoint("oracle", "realdb.internal/ORCLPDB"), {
  host: "realdb.internal",
  port: 1521,
});
assert.deepEqual(parseEndpoint("oracle", "//realdb.internal:1521/ORCLPDB"), {
  host: "realdb.internal",
  port: 1521,
});
assert.equal(
  rewriteConnectString("oracle", "realdb.internal:1521/ORCLPDB", local),
  "127.0.0.1:54021/ORCLPDB",
);
assert.equal(
  rewriteConnectString("oracle", "realdb.internal/ORCLPDB", local),
  "127.0.0.1:54021/ORCLPDB",
);
assert.equal(
  rewriteConnectString("oracle", "//realdb.internal:1521/ORCLPDB", local),
  "//127.0.0.1:54021/ORCLPDB",
);

console.log("endpoint.test.ts OK");
