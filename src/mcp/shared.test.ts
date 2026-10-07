import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tabular, assertWritable, readSourceFile } from "./shared.js";
import type { Config } from "../config.js";

test("tabular: lista vazia", () => {
  assert.deepEqual(tabular([]), { cols: [], rows: [], count: 0 });
});

test("tabular: abaixo do limite não marca truncated", () => {
  const r = tabular([{ a: 1, b: "x" }, { a: 2, b: "y" }], 5);
  assert.deepEqual(r, { cols: ["a", "b"], rows: [[1, "x"], [2, "y"]], count: 2 });
});

test("tabular: exatamente no limite não marca truncated", () => {
  const r = tabular([{ a: 1 }, { a: 2 }], 2);
  assert.equal(r.count, 2);
  assert.equal("truncated" in r, false);
});

test("tabular: acima do limite corta e reporta o total", () => {
  const r = tabular([{ a: 1 }, { a: 2 }, { a: 3 }], 2);
  assert.deepEqual(r.rows, [[1], [2]]);
  assert.equal(r.count, 2);
  assert.deepEqual({ total: r.total, truncated: r.truncated }, { total: 3, truncated: true });
});

test("tabular: colunas são a união das chaves, na mesma ordem em toda linha", () => {
  const r = tabular([{ a: 1 }, { b: 2 }]);
  assert.deepEqual(r.cols, ["a", "b"]);
  assert.deepEqual(r.rows, [[1, null], [null, 2]]);
});

test("tabular: só considera as chaves das linhas exibidas", () => {
  const r = tabular([{ a: 1 }, { z: 9 }], 1);
  assert.deepEqual(r.cols, ["a"]);
});

test("assertWritable: só readOnly === false libera escrita", () => {
  const cfg = {
    cacheDir: "",
    connections: {
      rw: { readOnly: false },
      ro: { readOnly: true },
      dflt: {},
      str: { readOnly: "false" },
    },
  } as unknown as Config;
  assert.doesNotThrow(() => assertWritable(cfg, "rw", "x"));
  for (const n of ["ro", "dflt", "str", "inexistente"]) {
    assert.throws(() => assertWritable(cfg, n, "x"), new RegExp(`Conexão "${n}" é read-only`));
  }
});

test("readSourceFile detecta encoding e preserva acento", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dba-src-"));
  const cases: [string, Buffer][] = [
    ["utf-8", Buffer.from("ação", "utf8")],
    ["utf-8", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("ação", "utf8")])],
    ["windows-1252", Buffer.from("ação", "latin1")],
    ["utf-16le", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("ação", "utf16le")])],
  ];
  for (const [i, [enc, bytes]] of cases.entries()) {
    const f = join(dir, `f${i}.sql`);
    writeFileSync(f, bytes);
    const r = await readSourceFile(f);
    assert.equal(r.text, "ação", enc);
    assert.equal(r.encoding, enc);
  }
  assert.equal((await readSourceFile(join(dir, "f2.sql"), "latin1")).text, "ação");
  await assert.rejects(readSourceFile(join(dir, "nao-existe.sql")));
});
