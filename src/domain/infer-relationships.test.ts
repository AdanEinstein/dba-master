import assert from "node:assert/strict";
import { inferImplicitFks } from "./infer-relationships.js";
import type { SchemaInventory } from "./types.js";

// Inventário fake: PEDIDO.CLIENTE_ID → CLIENTE.ID (implícita), PEDIDO.STATUS_ID já é FK
// declarada (deve ser ignorada), CLIENTE.ID é PK (ignorada).
const inv: SchemaInventory = {
  columns: [
    { owner: "APP", table: "CLIENTE", column: "ID", dataType: "NUMBER" },
    { owner: "APP", table: "CLIENTE", column: "NOME", dataType: "VARCHAR2" },
    { owner: "APP", table: "PEDIDO", column: "ID", dataType: "NUMBER" },
    { owner: "APP", table: "PEDIDO", column: "CLIENTE_ID", dataType: "NUMBER" },
    { owner: "APP", table: "PEDIDO", column: "STATUS_ID", dataType: "NUMBER" },
    { owner: "APP", table: "PEDIDO", column: "OBS", dataType: "VARCHAR2" },
  ],
  primaryKeys: [
    { owner: "APP", table: "CLIENTE", column: "ID" },
    { owner: "APP", table: "PEDIDO", column: "ID" },
    { owner: "APP", table: "STATUS", column: "ID" },
  ],
  declaredFkColumns: [{ owner: "APP", table: "PEDIDO", column: "STATUS_ID" }],
};

const out = inferImplicitFks(inv);

// CLIENTE_ID → CLIENTE.ID, high (nome bate + tipos numéricos).
const cliente = out.find((r) => r.from === "APP.PEDIDO.CLIENTE_ID");
assert.ok(cliente, "deveria inferir CLIENTE_ID");
assert.equal(cliente.to, "APP.CLIENTE.ID");
assert.equal(cliente.confidence, "high");

// STATUS_ID é FK declarada → não deve aparecer.
assert.ok(!out.some((r) => r.from === "APP.PEDIDO.STATUS_ID"), "FK declarada não deve ser inferida");

// PK e coluna comum não geram candidato.
assert.ok(!out.some((r) => r.from === "APP.PEDIDO.ID"), "PK não é candidata");
assert.ok(!out.some((r) => r.from === "APP.PEDIDO.OBS"), "coluna comum não casa");

// Tipos divergentes → medium.
const inv2: SchemaInventory = {
  columns: [
    { owner: "APP", table: "CLIENTE", column: "ID", dataType: "VARCHAR2" },
    { owner: "APP", table: "PEDIDO", column: "CLIENTE_ID", dataType: "NUMBER" },
  ],
  primaryKeys: [{ owner: "APP", table: "CLIENTE", column: "ID" }],
  declaredFkColumns: [],
};
assert.equal(inferImplicitFks(inv2)[0]?.confidence, "medium", "tipos divergentes → medium");

console.log("infer-relationships: OK");
