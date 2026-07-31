import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import type { Config } from "../../config.js";
import { generateInterfaces } from "../../../generator/schema-compiler.js";
import { jsonResult, errorResult, schemaArg, connectionArg } from "../shared.js";

// Compila em lote: gera/atualiza a interface .ts de todas as tabelas (e views) do schema.
export function register(server: McpServer, provider: ProviderManager, cfg: Config): void {
  server.registerTool(
    "generate_interfaces",
    {
      title: "Gerar interfaces (lote)",
      description:
        "Gera/atualiza em lote as interfaces .ts de todas as tabelas (e views) do schema. Incremental.",
      inputSchema: z.object({
        connectionName: connectionArg,
        schema: schemaArg,
        includeViews: z.boolean().optional().describe("Incluir views. Default: true."),
        force: z.boolean().optional().describe("Ignora o cache incremental e reescreve tudo. Default: false."),
      }),
    },
    async ({ connectionName, schema, includeViews, force }) => {
      const db = provider.getProvider(connectionName);
      const resolvedName = provider.resolveConnectionName(connectionName);
      const poolMax = cfg.connections[resolvedName]?.poolMax;
      try {
        const r = await generateInterfaces(db, cfg.cacheDir, resolvedName, { schema, includeViews, force, poolMax });
        return jsonResult({
          tables: r.tables,
          views: r.views,
          cacheDir: cfg.cacheDir,
          // ponytail: sem lista de arquivos — cacheDir + contagens bastam; liste o dir se precisar.
          errors: r.errors,
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
