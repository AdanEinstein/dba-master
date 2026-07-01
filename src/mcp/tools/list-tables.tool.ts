import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { DatabaseProvider } from "../../domain/database-provider.js";
import { jsonResult, errorResult, schemaArg } from "../shared.js";

export function register(server: McpServer, provider: DatabaseProvider): void {
  server.registerTool(
    "list_tables",
    {
      title: "Listar tabelas",
      description: "Lista tabelas (owner, nome, num_rows) de um schema ou de todos os schemas acessíveis.",
      inputSchema: z.object({ schema: schemaArg }),
    },
    async ({ schema }) => {
      try {
        return jsonResult({ tables: await provider.listTables(schema) });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
