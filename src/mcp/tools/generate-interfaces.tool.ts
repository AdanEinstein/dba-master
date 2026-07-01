import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import type { Config } from "../../config.js";
import { generateInterfaces } from "../../schema-compiler.js";
import { jsonResult, errorResult, schemaArg, connectionArg } from "../shared.js";

// Compila em lote: gera/atualiza a interface .ts de todas as tabelas (e views) do schema.
export function register(server: McpServer, provider: ProviderManager, cfg: Config): void {
  server.registerTool(
    "generate_interfaces",
    {
      title: "Gerar interfaces (lote)",
      description:
        "Varre todas as tabelas (e views) do schema e gera/atualiza suas interfaces .ts em cache. Incremental: pula objetos inalterados.",
      inputSchema: z.object({
        connectionName: connectionArg,
        schema: schemaArg,
        includeViews: z.boolean().optional().describe("Incluir views. Default: true."),
      }),
    },
    async ({ connectionName, schema, includeViews }) => {
      const db = provider.getProvider(connectionName);
      try {
        const r = await generateInterfaces(db, cfg.cacheDir, { schema, includeViews });
        return jsonResult({
          tables: r.tables,
          views: r.views,
          cacheDir: cfg.cacheDir,
          sample: r.files.slice(0, 50),
          errors: r.errors,
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
