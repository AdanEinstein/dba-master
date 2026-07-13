import { intro, outro, spinner, log, select, multiselect, isCancel } from "@clack/prompts";
import cfonts from "cfonts";

import { loadConfig } from "../src/config.js";
import { ProviderManager } from "../src/infrastructure/provider-manager.js";
import type { DatabaseProvider } from "../src/domain/database-provider.js";
import { generateInterfaces, type GenerateResult } from "./schema-compiler.js";

// Owners distintos de tabelas+views (sem filtro de schema) — reusa o que o provider já expõe,
// sem exigir um método novo (listSchemas) na porta DatabaseProvider.
async function listSchemas(db: DatabaseProvider): Promise<string[]> {
  const [tables, views] = await Promise.all([db.listTables(), db.listViews()]);
  const owners = new Set([...tables.map((t) => t.owner), ...views.map((v) => v.owner)]);
  return [...owners].sort();
}

// Subcomando `npx -y dba-master@latest generate`: compila as interfaces .ts do schema, standalone.
// UI animada no mesmo estilo do setup (cfonts + spinner @clack).
export async function runGenerate(args: string[]): Promise<void> {
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const schemaFlag = flag("--schema");
  const explicitSchemas = schemaFlag?.split(",").map((s) => s.trim()).filter(Boolean);
  const connection = flag("--connection");
  const includeViews = !args.includes("--no-views");
  const force = args.includes("--force");

  console.clear();
  cfonts.say("DBA-MASTER", {
    font: "block",
    align: "left",
    colors: ["#f80", "#f40"],
    background: "transparent",
    letterSpacing: 1,
    lineHeight: 1,
    space: true,
    maxLength: "0",
    gradient: ["red", "blue"],
    independentGradient: false,
    transitionGradient: true,
    env: "node",
  });

  intro("Compilando interfaces do schema");

  const cfg = loadConfig();
  const mgr = new ProviderManager(cfg);

  let selectedConnection = connection;
  if (!selectedConnection) {
    const available = mgr.getAvailableConnections();
    if (available.length > 1) {
      const result = await select({
        message: "Múltiplas conexões disponíveis. Qual deseja utilizar?",
        options: available.map((c) => ({ value: c, label: c })),
      });
      if (isCancel(result)) {
        log.warn("Operação cancelada.");
        process.exit(0);
      }
      selectedConnection = result as string;
    }
  }

  const s = spinner();

  try {
    const db = mgr.getProvider(selectedConnection);
    const resolvedName = mgr.resolveConnectionName(selectedConnection);

    let schemas = explicitSchemas;
    if (!schemas) {
      s.start("Buscando schemas...");
      const available = await listSchemas(db);
      s.stop(`${available.length} schema(s) encontrado(s).`);

      const result = await multiselect({
        message: "Quais schemas deseja gerar?",
        options: available.map((sc) => ({ value: sc, label: sc })),
        initialValues: available,
        required: true,
      });
      if (isCancel(result)) {
        log.warn("Operação cancelada.");
        process.exit(0);
      }
      schemas = result as string[];
    }

    s.start("Lendo schema...");
    const totals: GenerateResult = { tables: 0, views: 0, files: [], errors: [] };
    for (const schema of schemas) {
      const r = await generateInterfaces(db, cfg.cacheDir, resolvedName, {
        schema,
        includeViews,
        force,
        onProgress: (done, total, name) => s.message(`[${schema}] (${done}/${total}) ${name}`),
      });
      totals.tables += r.tables;
      totals.views += r.views;
      totals.files.push(...r.files);
      totals.errors.push(...r.errors);
    }

    s.stop(`Interfaces geradas em ${cfg.cacheDir}`);
    log.success(`schemas: ${schemas.length} · tabelas: ${totals.tables} · views: ${totals.views} · erros: ${totals.errors.length}`);
    for (const e of totals.errors) log.warn(`${e.name}: ${e.error}`);

    outro("Concluído!");
  } catch (e) {
    s.stop("Falha ao compilar interfaces.");
    // AggregateError (ex.: pg em ECONNREFUSED) tem .message vazia — o detalhe fica em .errors[].
    const detail = e instanceof AggregateError
      ? e.errors.map((x) => (x instanceof Error ? x.message : String(x))).join("; ")
      : e instanceof Error ? e.message : String(e);
    log.error(detail || String(e));
    process.exitCode = 1;
  } finally {
    await mgr.closeAll();
  }
}
