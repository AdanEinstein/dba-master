import { test } from "node:test";
import assert from "node:assert/strict";
import { PgConnection } from "./postgres/pg-connection.js";
import { MysqlConnection } from "./mysql/mysql-connection.js";

// Chamadas simultâneas na 1ª vez (Promise.all do inventário, workers do generate) devem
// compartilhar UM pool. Antes, cada uma criava o seu e os extras vazavam (conexões + túnel).
// Pools pg/mysql2 são lazy: criar não disca, então roda sem banco.
for (const [name, conn] of [
  ["pg", new PgConnection({ engine: "postgres", user: "", connectString: "postgresql://u:p@127.0.0.1:1/db" })],
  ["mysql", new MysqlConnection({ engine: "mysql", user: "", connectString: "mysql://u:p@127.0.0.1:1/db" })],
] as const) {
  test(`${name}: getPool concorrente cria um pool só`, async () => {
    const pools = await Promise.all([1, 2, 3].map(() => (conn as any).getPool()));
    assert.ok(pools.every((p) => p === pools[0]));
    await conn.close();
  });
}
