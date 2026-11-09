import { test } from "node:test";
import assert from "node:assert/strict";
import { OracleProvider } from "./oracle-provider.js";

// Sem banco: troca o query() da conexão por um stub que responde por padrão de SQL e conta as idas.
function stubbed(answer: (sql: string) => object[]) {
  const p = new OracleProvider({ engine: "oracle", user: "u", connectString: "h/s" }, { connections: {}, cacheDir: "" });
  const calls: string[] = [];
  (p as any).conn.query = async (sql: string) => (calls.push(sql), answer(sql));
  return { p, calls };
}

test("listPackages: 3 queries fixas (não N+1) e detalhe só p/ os `limit` primeiros", async () => {
  const { p, calls } = stubbed((sql) => {
    if (sql.includes("object_type = 'PACKAGE'"))
      return ["A", "B", "C"].map((n) => ({ OWNER: "APP", OBJECT_NAME: n }));
    if (sql.includes("all_procedures"))
      return [
        { OWNER: "APP", OBJECT_NAME: "A", PROCEDURE_NAME: "P1" },
        { OWNER: "APP", OBJECT_NAME: "B", PROCEDURE_NAME: "P2" },
      ];
    if (sql.includes("all_arguments"))
      return [{ OWNER: "APP", PACKAGE_NAME: "A", OBJECT_NAME: "P1", ARGUMENT_NAME: "X", POSITION: 1, DATA_TYPE: "NUMBER", IN_OUT: "IN" }];
    throw new Error(`SQL inesperado: ${sql}`);
  });

  const pkgs = await p.listPackages("APP", undefined, 2);
  assert.equal(calls.length, 3);
  assert.ok(!calls.some((s) => s.includes(":n2")), "C (fora do limit) não entra no IN");
  assert.equal(pkgs.length, 3, "total preservado p/ o truncated da tool");
  assert.deepEqual(pkgs[0].subprograms[0].arguments, [{ name: "X", position: 1, dataType: "NUMBER", inOut: "IN" }]);
  assert.deepEqual(pkgs[1].subprograms.map((s) => s.name), ["P2"]);
  assert.deepEqual(pkgs[1].subprograms[0].arguments, []);
  assert.deepEqual(pkgs[2].subprograms, []);
});

test("listProcedures: 2 queries mesmo com muitas rotinas; IN quebra em lotes de 1000", async () => {
  const names = Array.from({ length: 1500 }, (_, i) => `R${i}`);
  const { p, calls } = stubbed((sql) => {
    if (sql.includes("all_objects")) return names.map((n) => ({ OWNER: "APP", OBJECT_NAME: n, OBJECT_TYPE: "PROCEDURE" }));
    if (sql.includes("all_arguments"))
      return [{ OWNER: "APP", PACKAGE_NAME: null, OBJECT_NAME: "R7", ARGUMENT_NAME: "Y", POSITION: 1, DATA_TYPE: "DATE", IN_OUT: "OUT" }];
    throw new Error(`SQL inesperado: ${sql}`);
  });

  const procs = await p.listProcedures("APP");
  assert.equal(calls.length, 3); // routines + 2 lotes (1000 + 500)
  assert.equal(procs.length, 1500);
  assert.equal(procs[7].arguments[0].name, "Y");
  assert.deepEqual(procs[8].arguments, []);
});
