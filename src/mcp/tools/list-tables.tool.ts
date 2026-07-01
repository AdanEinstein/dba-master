import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import { jsonResult, errorResult, schemaArg , connectionArg } from "../shared.js";

export function register(server: McpServer, provider: ProviderManager): void {
  server.registerTool(
    "list_tables",
    {
      title: "Listar tabelas",
      description: "Lista tabelas (owner, nome, num_rows) de um schema ou de todos os schemas acessíveis.",
      inputSchema: z.object({
      connectionName: connectionArg,
      schema: schemaArg }),
    },
    async ({ connectionName, schema }) => {
      const db = provider.getProvider(connectionName);

      try {
        return jsonResult({ tables: await db.listTables(schema) });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
