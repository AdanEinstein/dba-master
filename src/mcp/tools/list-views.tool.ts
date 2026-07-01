import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import { jsonResult, errorResult, schemaArg, patternArg, connectionArg } from "../shared.js";

export function register(server: McpServer, provider: ProviderManager): void {
  server.registerTool(
    "list_views",
    {
      title: "Listar views",
      description:
        "Lista views (owner, nome) de um schema ou de todos os schemas acessíveis. Filtra por substring com 'pattern'.",
      inputSchema: z.object({
        connectionName: connectionArg,
        schema: schemaArg,
        pattern: patternArg,
      }),
    },
    async ({ connectionName, schema, pattern }) => {
      const db = provider.getProvider(connectionName);

      try {
        return jsonResult({ views: await db.listViews(schema, pattern) });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
