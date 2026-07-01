import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateInterface, type ColumnInfo, type TypeMapper } from "../domain/types.js";

// Infraestrutura DB-agnóstica: persiste o cache de interfaces .ts no filesystem.

/** last_ddl gravado no header do arquivo de cache, se existir e não for "unknown". */
export function readCachedDdlTime(content: string): string | undefined {
  const m = content.match(/^\/\/ last_ddl: (.+)$/m);
  return m && m[1] !== "unknown" ? m[1] : undefined;
}

/**
 * Grava (incremental) a interface .ts da tabela em cacheDir/<OWNER>/<TABLE>.ts.
 * Se o LAST_DDL_TIME do header bater com o atual, pula a regeneração.
 * O mapeamento de tipos vem do provider (DB-específico).
 */
export async function writeTableCache(
  cacheDir: string,
  owner: string,
  table: string,
  columns: ColumnInfo[],
  typeToTs: TypeMapper,
  lastDdl: string | undefined,
): Promise<string> {
  const dir = join(cacheDir, owner);
  const file = join(dir, `${table}.ts`);

  if (lastDdl) {
    try {
      const existing = await readFile(file, "utf8");
      if (readCachedDdlTime(existing) === lastDdl) return file; // inalterada
    } catch {
      // arquivo não existe ainda — segue gerando
    }
  }

  await mkdir(dir, { recursive: true });
  await writeFile(file, generateInterface(owner, table, columns, typeToTs, lastDdl), "utf8");
  return file;
}
