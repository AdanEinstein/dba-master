import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateInterface, type ColumnInfo } from "../domain/types.js";
import {
  readCachedFreshToken,
  readFreshCache,
  tableCachePath,
  writeTableCache,
} from "./schema-cache.js";

const idType = (t: string) => (/int|number/i.test(t) ? "number" : "string");
const cols: ColumnInfo[] = [
  { name: "ID", dataType: "NUMBER", nullable: false },
  { name: "NOME", dataType: "VARCHAR2", nullable: true },
];

test("header emite // fresh: só quando freshToken existe", () => {
  const com = generateInterface("HR", "EMP", cols, idType, { kind: "table", freshToken: "tok-123" });
  assert.match(com, /^\/\/ fresh: tok-123$/m);
  assert.equal(readCachedFreshToken(com), "tok-123");

  const sem = generateInterface("HR", "EMP", cols, idType, { kind: "table" });
  assert.doesNotMatch(sem, /\/\/ fresh:/);
  assert.equal(readCachedFreshToken(sem), undefined);
});

test("readFreshCache: HIT com token igual, MISS com token diferente/ausente", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dba-cache-"));
  await writeTableCache(dir, "conn", "HR", "EMP", cols, idType, { kind: "table", freshToken: "v1" });

  // HIT: mesmo token → devolve caminho + contagem de colunas
  const hit = await readFreshCache(dir, "conn", "HR", "EMP", "v1");
  assert.ok(hit);
  assert.equal(hit.file, tableCachePath(dir, "conn", "HR", "EMP"));
  assert.equal(hit.columnCount, 2);

  // MISS: token divergente (schema mudou)
  assert.equal(await readFreshCache(dir, "conn", "HR", "EMP", "v2"), undefined);

  // MISS: arquivo inexistente
  assert.equal(await readFreshCache(dir, "conn", "HR", "OUTRA", "v1"), undefined);
});

test("cache antigo sem // fresh: nunca dá HIT", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dba-cache-"));
  // grava SEM freshToken (simula cache legado)
  await writeTableCache(dir, "conn", "HR", "OLD", cols, idType, { kind: "table" });
  const content = await readFile(tableCachePath(dir, "conn", "HR", "OLD"), "utf8");
  assert.equal(readCachedFreshToken(content), undefined);
  // qualquer token vivo → miss (não valida)
  assert.equal(await readFreshCache(dir, "conn", "HR", "OLD", "qualquer"), undefined);
});
