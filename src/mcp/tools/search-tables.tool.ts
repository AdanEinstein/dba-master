import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { DatabaseProvider } from "../../domain/database-provider.js";
import { jsonResult, errorResult, schemaArg } from "../shared.js";

export function register(server: McpServer, provider: DatabaseProvider): void {
  server.registerTool(
    "search_tables",
    {
      title: "Buscar tabelas",
      description: "Busca tabelas cujo nome contém o padrão informado (case-insensitive).",
      inputSchema: z.object({
        pattern: z.string().describe("Substring do nome da tabela a procurar."),
        schema: schemaArg,
      }),
    },
    async ({ pattern, schema }) => {
      try {
        return jsonResult({ tables: await provider.searchTables(pattern, schema) });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
