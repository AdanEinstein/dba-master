import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import { jsonResult, errorResult, schemaArg, connectionArg, tabular } from "../shared.js";

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
        const r = await db.getRelationships(table, schema);
        return jsonResult({
          owner: r.owner, tableName: r.tableName,
          outgoing: tabular(r.outgoing), incoming: tabular(r.incoming),
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
