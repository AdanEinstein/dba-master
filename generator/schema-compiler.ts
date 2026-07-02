import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseProvider } from "../src/domain/database-provider.js";
import { writeTableCache } from "../src/infrastructure/schema-cache.js";
import { inferImplicitFks } from "../src/domain/infer-relationships.js";
import type { ImpliedRelationship } from "../src/domain/types.js";
import { DEFAULT_POOL_MAX } from "../src/config.js";

// Compila em lote: varre tabelas (e views) do schema e gera/atualiza as interfaces .ts.
// Composição DB-agnóstica sobre describeTable/describeView + writeTableCache (incremental).

export interface GenerateOptions {
  schema?: string;
  includeViews?: boolean; // default: true
  /** Ignora o cache incremental e reescreve todos os arquivos. */
  force?: boolean;
  /** Concorrência máxima permitida (default: 8) */
  poolMax?: number;
  /** Callback de progresso (para spinner/animação). Chamado a cada objeto processado. */
  onProgress?: (done: number, total: number, name: string) => void;
}

export interface GenerateResult {
  tables: number;
  views: number;
  files: string[];
  errors: { name: string; error: string }[];
}


// ponytail: worker-pool caseiro. Concorrência = poolMax; mais que isso só
// enfileira no pool sem ganho. p-limit se algum dia precisar de mais controle.
async function mapPool<T>(items: T[], limit: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  const worker = async () => { while (i < items.length) await fn(items[i++]); };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// ponytail: reusa describeTable/describeView (traz PK/FK/índices/text que a interface não usa) —
// simples e o cache incremental pula reescrita de arquivos inalterados. Se compilar schema
// gigante ficar lento, adicionar um método column-only no provider.

export async function generateInterfaces(
  db: DatabaseProvider,
  cacheDir: string,
  connectionName: string,
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const files: string[] = [];
  const errors: { name: string; error: string }[] = [];
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  const tableRefs = await db.listTables(opts.schema);
  const viewRefs = opts.includeViews !== false ? await db.listViews(opts.schema) : [];
  const total = tableRefs.length + viewRefs.length;
  let done = 0;

  const typeToTs = db.typeToTs.bind(db);
  const poolMax = opts.poolMax ?? DEFAULT_POOL_MAX; // Limite de concorrência

  // FKs implícitas: 1 varredura do schema inteiro, agrupada por tabela de origem.
  // ponytail: degrada p/ vazio se o inventário falhar — não derruba o generate inteiro.
  const impliedByTable = new Map<string, ImpliedRelationship[]>();
  try {
    for (const r of inferImplicitFks(await db.getSchemaInventory(opts.schema))) {
      const key = r.from.split(".").slice(0, -1).join("."); // OWNER.TABLE
      (impliedByTable.get(key) ?? impliedByTable.set(key, []).get(key)!).push(r);
    }
  } catch (e) {
    errors.push({ name: "infer_relationships", error: msg(e) });
  }

  let tables = 0;
  await mapPool(tableRefs, poolMax, async (t) => {
    const name = `${t.owner}.${t.tableName}`;


    try {
      const s = await db.describeTable(t.tableName, t.owner);
      // FKs de entrada não vêm do describeTable — buscadas à parte (usamos só .incoming).
      const { incoming } = await db.getRelationships(s.tableName, s.owner);
      const meta = {
        kind: "table" as const,
        lastDdlTime: s.lastDdlTime,
        comment: s.comment,
        primaryKey: s.primaryKey,
        foreignKeys: s.foreignKeys,
        incoming,
        impliedForeignKeys: impliedByTable.get(`${s.owner}.${s.tableName}`),
        checkConstraints: s.checkConstraints,
        indexes: s.indexes,
      };
      files.push(await writeTableCache(cacheDir, connectionName, s.owner, s.tableName, s.columns, typeToTs, meta, opts.force));
      tables++;
    } catch (e) {
      errors.push({ name, error: msg(e) });
    } finally {
      opts.onProgress?.(++done, total, name);
    }
  });

  let views = 0;
  await mapPool(viewRefs, poolMax, async (v) => {
    const name = `${v.owner}.${v.viewName}`;


    try {
      const s = await db.describeView(v.viewName, v.owner);
      const meta = { kind: "view" as const, lastDdlTime: s.lastDdlTime, comment: s.comment };
      files.push(await writeTableCache(cacheDir, connectionName, s.owner, s.viewName, s.columns, typeToTs, meta, opts.force));
      views++;
    } catch (e) {
      errors.push({ name, error: msg(e) });
    } finally {
      opts.onProgress?.(++done, total, name);
    }
  });

  files.sort();
  return { tables, views, files, errors };
}
