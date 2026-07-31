import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import { jsonResult, errorResult, schemaArg, patternArg, connectionArg, tabular, limitArg } from "../shared.js";

export function register(server: McpServer, provider: ProviderManager): void {
  server.registerTool(
    "list_procedures",
    {
      title: "Listar procedures/functions",
      description:
        "Lista procedures e functions standalone (fora de packages), com assinatura dos parâmetros.",
      inputSchema: z.object({
      connectionName: connectionArg,
      schema: schemaArg, pattern: patternArg, limit: limitArg }),
    },
    async ({ connectionName, schema, pattern, limit }) => {
      const db = provider.getProvider(connectionName);

      try {
        return jsonResult(tabular(await db.listProcedures(schema, pattern), limit));
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
