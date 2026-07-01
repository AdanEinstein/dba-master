import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateInterface, type ColumnInfo, type InterfaceMeta, type TypeMapper } from "../domain/types.js";

// Infraestrutura DB-agnóstica: persiste o cache de interfaces .ts no filesystem.

/** last_ddl gravado no header do arquivo de cache, se existir e não for "unknown". */
export function readCachedDdlTime(content: string): string | undefined {
  const m = content.match(/^\/\/ last_ddl: (.+)$/m);
  return m && m[1] !== "unknown" ? m[1] : undefined;
}

/**
 * Grava (incremental) a interface .ts da tabela/view em cacheDir/<OWNER>/<OBJ>.ts.
 * Se o LAST_DDL_TIME do header bater com o atual, pula a regeneração (a menos de `force`).
 * O mapeamento de tipos vem do provider (DB-específico); `meta` traz kind/relacionamentos.
 *
 * ponytail: o cache é invalidado só pelo last_ddl do próprio objeto. Criar uma FK em
 * OUTRA tabela apontando p/ esta não altera o last_ddl daqui, então a seção
 * "referenciada por" pode ficar velha até um `force`. Upgrade path: hash do conteúdo.
 */
export async function writeTableCache(
  cacheDir: string,
  owner: string,
  table: string,
  columns: ColumnInfo[],
  typeToTs: TypeMapper,
  meta: InterfaceMeta,
  force = false,
): Promise<string> {
  const dir = join(cacheDir, owner);
  const file = join(dir, `${table}.ts`);

  if (!force && meta.lastDdlTime) {
    try {
      const existing = await readFile(file, "utf8");
      if (readCachedDdlTime(existing) === meta.lastDdlTime) return file; // inalterada
    } catch {
      // arquivo não existe ainda — segue gerando
    }
  }

  await mkdir(dir, { recursive: true });
  await writeFile(file, generateInterface(owner, table, columns, typeToTs, meta), "utf8");
  return file;
}
