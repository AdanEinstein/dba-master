import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { DatabaseProvider } from "../../domain/database-provider.js";
import { jsonResult, errorResult, schemaArg } from "../shared.js";

export function register(server: McpServer, provider: DatabaseProvider): void {
  server.registerTool(
    "get_relationships",
    {
      title: "Relacionamentos (grafo de FKs)",
      description:
        "Grafo de FKs de uma tabela: 'outgoing' (FKs que ela possui) e 'incoming' (tabelas que a referenciam).",
      inputSchema: z.object({ table: z.string().describe("Nome da tabela."), schema: schemaArg }),
    },
    async ({ table, schema }) => {
      try {
        return jsonResult(await provider.getRelationships(table, schema));
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
