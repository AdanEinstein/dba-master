import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import { jsonResult, errorResult, schemaArg, patternArg, connectionArg, tabular, limitArg } from "../shared.js";

export function register(server: McpServer, provider: ProviderManager): void {
  server.registerTool(
    "list_tables",
    {
      title: "Listar tabelas",
      description: "Lista tabelas (owner, nome, num_rows) de um schema ou de todos os acessíveis.",
      inputSchema: z.object({
      connectionName: connectionArg,
      schema: schemaArg, pattern: patternArg, limit: limitArg }),
    },
    async ({ connectionName, schema, pattern, limit }) => {
      const db = provider.getProvider(connectionName);

      try {
        const tables = await db.listTables(schema);
        // ponytail: filtro em memória — listTables não recebe pattern; empurrar pro SQL só se medir lento.
        const p = pattern?.toUpperCase();
        return jsonResult(tabular(p ? tables.filter((t) => t.tableName.toUpperCase().includes(p)) : tables, limit));
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
