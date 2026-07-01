import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import type { Config } from "../../config.js";
import { writeTableCache } from "../../infrastructure/schema-cache.js";
import { jsonResult, errorResult, schemaArg, connectionArg } from "../shared.js";

// Compõe a descrição da view com a geração do cache .ts (cross-cutting, DB-agnóstico).
export function register(server: McpServer, provider: ProviderManager, cfg: Config): void {
  server.registerTool(
    "describe_view",
    {
      title: "Descrever view",
      description:
        "Detalha uma view: colunas (tipo, nullable) e o SELECT que a define. Gera/atualiza a interface .ts em cache.",
      inputSchema: z.object({
        connectionName: connectionArg,
        view: z.string().describe("Nome da view."),
        schema: schemaArg,
      }),
    },
    async ({ connectionName, view, schema }) => {
      const db = provider.getProvider(connectionName);

      try {
        const s = await db.describeView(view, schema);
        const cacheFile = await writeTableCache(
          cfg.cacheDir, s.owner, s.viewName, s.columns, db.typeToTs.bind(provider), s.lastDdlTime,
        );
        return jsonResult({ ...s, cacheFile });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
