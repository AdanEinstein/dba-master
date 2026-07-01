import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import { jsonResult, errorResult, schemaArg , connectionArg } from "../shared.js";

export function register(server: McpServer, provider: ProviderManager): void {
  server.registerTool(
    "get_relationships",
    {
      title: "Relacionamentos (grafo de FKs)",
      description:
        "Grafo de FKs de uma tabela: 'outgoing' (FKs que ela possui) e 'incoming' (tabelas que a referenciam).",
      inputSchema: z.object({
      connectionName: connectionArg,
      table: z.string().describe("Nome da tabela."), schema: schemaArg }),
    },
    async ({ connectionName, table, schema }) => {
      const db = provider.getProvider(connectionName);

      try {
        return jsonResult(await db.getRelationships(table, schema));
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
