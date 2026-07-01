import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateInterface, type ColumnInfo, type InterfaceMeta, type TypeMapper } from "../domain/types.js";

// Infraestrutura DB-agnóstica: persiste o cache de interfaces .ts no filesystem.

/** hash gravado no header do arquivo de cache. */
export function readCachedHash(content: string): string | undefined {
  const m = content.match(/^\/\/ hash: ([a-f0-9]+)$/m);
  return m ? m[1] : undefined;
}

/**
 * Grava a interface .ts da tabela/view em cacheDir/<OWNER>/<OBJ>.ts.
 * Se o hash do header bater com o atual, pula a regeneração (a menos de `force`).
 * O mapeamento de tipos vem do provider (DB-específico); `meta` traz kind/relacionamentos.
 *
 * ponytail: o cache é invalidado pelo hash do conteúdo. Criar uma FK em
 * OUTRA tabela apontando p/ esta altera o conteúdo (seção "referenciada por"),
 * invalidando o cache corretamente.
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

  const content = generateInterface(owner, table, columns, typeToTs, meta);

  if (!force) {
    try {
      const existing = await readFile(file, "utf8");
      if (readCachedHash(existing) === readCachedHash(content)) return file; // inalterada
    } catch {
      // arquivo não existe ainda — segue gerando
    }
  }

  await mkdir(dir, { recursive: true });
  await writeFile(file, content, "utf8");
  return file;
}
