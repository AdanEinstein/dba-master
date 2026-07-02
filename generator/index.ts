import { intro, outro, spinner, log, select, isCancel } from "@clack/prompts";
import cfonts from "cfonts";

import { loadConfig } from "../src/config.js";
import { ProviderManager } from "../src/infrastructure/provider-manager.js";
import { generateInterfaces } from "./schema-compiler.js";

// Subcomando `npx -y dba-master@latest generate`: compila as interfaces .ts do schema, standalone.
// UI animada no mesmo estilo do setup (cfonts + spinner @clack).
export async function runGenerate(args: string[]): Promise<void> {
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const schema = flag("--schema");
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
    s.start("Lendo schema...");

    const r = await generateInterfaces(db, cfg.cacheDir, resolvedName, {
      schema,
      includeViews,
      force,
      onProgress: (done, total, name) => s.message(`(${done}/${total}) ${name}`),
    });

    s.stop(`Interfaces geradas em ${cfg.cacheDir}`);
    log.success(`tabelas: ${r.tables} · views: ${r.views} · erros: ${r.errors.length}`);
    for (const e of r.errors) log.warn(`${e.name}: ${e.error}`);

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
