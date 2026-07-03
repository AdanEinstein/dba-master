import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateInterface, type ColumnInfo, type InterfaceMeta, type TypeMapper } from "../domain/types.js";

// Infraestrutura DB-agnóstica: persiste o cache de interfaces .ts no filesystem.

/** hash gravado no header do arquivo de cache. */
export function readCachedHash(content: string): string | undefined {
  const m = content.match(/^\/\/ hash: ([a-f0-9]+)$/m);
  return m ? m[1] : undefined;
}

/** Token de frescor gravado no header (`// fresh:`). Ausente em cache antigo → undefined. */
export function readCachedFreshToken(content: string): string | undefined {
  const m = content.match(/^\/\/ fresh: (.+)$/m);
  return m ? m[1].trim() : undefined;
}

/** Caminho do .ts de um objeto: cacheDir/<connectionName>/<OWNER>/<OBJ>.ts. */
export function tableCachePath(cacheDir: string, connectionName: string, owner: string, table: string): string {
  return join(cacheDir, connectionName, owner, `${table}.ts`);
}

// Conta as linhas de coluna da interface (`  KEY: tipo;`), ignorando JSDoc e `}`.
// ponytail: heurística por regex — suficiente pro columnCount informativo da resposta enxuta.
function countCachedColumns(content: string): number {
  return (content.match(/^ {2}("|\w)[^\n]*;$/gm) ?? []).length;
}

/**
 * Fast-path do cache: se o .ts existe e seu token de frescor bate com `token`,
 * devolve o caminho + contagem de colunas (sem describe). Caso contrário undefined.
 */
export async function readFreshCache(
  cacheDir: string,
  connectionName: string,
  owner: string,
  table: string,
  token: string,
): Promise<{ file: string; columnCount: number } | undefined> {
  const file = tableCachePath(cacheDir, connectionName, owner, table);
  try {
    const content = await readFile(file, "utf8");
    if (readCachedFreshToken(content) === token) {
      return { file, columnCount: countCachedColumns(content) };
    }
  } catch {
    // arquivo não existe — miss
  }
  return undefined;
}

/**
 * Grava a interface .ts da tabela/view em cacheDir/<connectionName>/<OWNER>/<OBJ>.ts.
 * Se o hash do header bater com o atual, pula a regeneração (a menos de `force`).
 * O mapeamento de tipos vem do provider (DB-específico); `meta` traz kind/relacionamentos.
 *
 * ponytail: o cache é invalidado pelo hash do conteúdo. Criar uma FK em
 * OUTRA tabela apontando p/ esta altera o conteúdo (seção "referenciada por"),
 * invalidando o cache corretamente.
 */
export async function writeTableCache(
  cacheDir: string,
  connectionName: string,
  owner: string,
  table: string,
  columns: ColumnInfo[],
  typeToTs: TypeMapper,
  meta: InterfaceMeta,
  force = false,
): Promise<string> {
  const dir = join(cacheDir, connectionName, owner);
  const file = tableCachePath(cacheDir, connectionName, owner, table);

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

  const connectionDir = join(cacheDir, connectionName);
  const tsConfigPath = join(connectionDir, "tsconfig.json");
  try {
    await writeFile(
      tsConfigPath,
      JSON.stringify(
        {
          compilerOptions: {
            target: "esnext",
            moduleResolution: "node",
            allowJs: true,
            skipLibCheck: true,
          },
          include: ["**/*.ts"],
        },
        null,
        2
      ),
      { flag: "wx" }
    );
  } catch {
    // ignora erro (arquivo já existe)
  }

  return file;
}
