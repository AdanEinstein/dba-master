import { loadConfig } from "./config.js";
import { ProviderManager } from "./infrastructure/provider-manager.js";
import { generateInterfaces } from "./schema-compiler.js";

// Subcomando `npx dba-master generate`: compila as interfaces .ts do schema, standalone.
export async function runGenerate(args: string[]): Promise<void> {
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const schema = flag("--schema");
  const connection = flag("--connection");
  const includeViews = !args.includes("--no-views");

  const cfg = loadConfig();
  const mgr = new ProviderManager(cfg);
  try {
    const db = mgr.getProvider(connection);
    const r = await generateInterfaces(db, cfg.cacheDir, { schema, includeViews });
    console.log(`Interfaces geradas em: ${cfg.cacheDir}`);
    console.log(`  tabelas: ${r.tables} | views: ${r.views} | erros: ${r.errors.length}`);
    for (const e of r.errors) console.log(`  erro em ${e.name}: ${e.error}`);
  } finally {
    await mgr.closeAll();
  }
}
