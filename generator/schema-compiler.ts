import type { DatabaseProvider } from "../src/domain/database-provider.js";
import { writeTableCache } from "../src/infrastructure/schema-cache.js";

// Compila em lote: varre tabelas (e views) do schema e gera/atualiza as interfaces .ts.
// Composição DB-agnóstica sobre describeTable/describeView + writeTableCache (incremental).

export interface GenerateOptions {
  schema?: string;
  includeViews?: boolean; // default: true
  /** Ignora o cache incremental e reescreve todos os arquivos. */
  force?: boolean;
  /** Callback de progresso (para spinner/animação). Chamado a cada objeto processado. */
  onProgress?: (done: number, total: number, name: string) => void;
}

export interface GenerateResult {
  tables: number;
  views: number;
  files: string[];
  errors: { name: string; error: string }[];
}

// ponytail: reusa describeTable/describeView (traz PK/FK/índices/text que a interface não usa) —
// simples e o cache incremental pula reescrita de arquivos inalterados. Se compilar schema
// gigante ficar lento, adicionar um método column-only no provider.
export async function generateInterfaces(
  db: DatabaseProvider,
  cacheDir: string,
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

  let tables = 0;
  for (const t of tableRefs) {
    const name = `${t.owner}.${t.tableName}`;
    opts.onProgress?.(++done, total, name);
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
        checkConstraints: s.checkConstraints,
        indexes: s.indexes,
      };
      files.push(await writeTableCache(cacheDir, s.owner, s.tableName, s.columns, typeToTs, meta, opts.force));
      tables++;
    } catch (e) {
      errors.push({ name, error: msg(e) });
    }
  }

  let views = 0;
  for (const v of viewRefs) {
    const name = `${v.owner}.${v.viewName}`;
    opts.onProgress?.(++done, total, name);
    try {
      const s = await db.describeView(v.viewName, v.owner);
      const meta = { kind: "view" as const, lastDdlTime: s.lastDdlTime, comment: s.comment };
      files.push(await writeTableCache(cacheDir, s.owner, s.viewName, s.columns, typeToTs, meta, opts.force));
      views++;
    } catch (e) {
      errors.push({ name, error: msg(e) });
    }
  }

  return { tables, views, files, errors };
}
