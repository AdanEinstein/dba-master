import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import { jsonResult, errorResult, schemaArg , connectionArg } from "../shared.js";

export function register(server: McpServer, provider: ProviderManager): void {
  server.registerTool(
    "search_tables",
    {
      title: "Buscar tabelas",
      description: "Busca tabelas cujo nome contém o padrão informado (case-insensitive).",
      inputSchema: z.object({
      connectionName: connectionArg,
      pattern: z.string().describe("Substring do nome da tabela a procurar."),
        schema: schemaArg,
      }),
    },
    async ({ connectionName, pattern, schema }) => {
      const db = provider.getProvider(connectionName);

      try {
        return jsonResult({ tables: await db.searchTables(pattern, schema) });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
