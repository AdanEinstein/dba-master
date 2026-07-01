import type { DatabaseProvider } from "./domain/database-provider.js";
import { writeTableCache } from "./infrastructure/schema-cache.js";

// Compila em lote: varre tabelas (e views) do schema e gera/atualiza as interfaces .ts.
// Composição DB-agnóstica sobre describeTable/describeView + writeTableCache (incremental).

export interface GenerateOptions {
  schema?: string;
  includeViews?: boolean; // default: true
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

  let tables = 0;
  for (const t of await db.listTables(opts.schema)) {
    try {
      const s = await db.describeTable(t.tableName, t.owner);
      files.push(await writeTableCache(cacheDir, s.owner, s.tableName, s.columns, db.typeToTs.bind(db), s.lastDdlTime));
      tables++;
    } catch (e) {
      errors.push({ name: `${t.owner}.${t.tableName}`, error: msg(e) });
    }
  }

  let views = 0;
  if (opts.includeViews !== false) {
    for (const v of await db.listViews(opts.schema)) {
      try {
        const s = await db.describeView(v.viewName, v.owner);
        files.push(await writeTableCache(cacheDir, s.owner, s.viewName, s.columns, db.typeToTs.bind(db), s.lastDdlTime));
        views++;
      } catch (e) {
        errors.push({ name: `${v.owner}.${v.viewName}`, error: msg(e) });
      }
    }
  }

  return { tables, views, files, errors };
}
