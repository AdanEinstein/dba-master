import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import { jsonResult, errorResult, schemaArg, patternArg, connectionArg, tabular, limitArg } from "../shared.js";

export function register(server: McpServer, provider: ProviderManager): void {
  server.registerTool(
    "list_schedulers_jobs",
    {
      title: "Listar jobs do scheduler",
      description:
        "Lista jobs agendados (ação, agendamento, estado, próxima execução). O sistema de jobs varia por banco.",
      inputSchema: z.object({
      connectionName: connectionArg,
      schema: schemaArg, pattern: patternArg, limit: limitArg }),
    },
    async ({ connectionName, schema, pattern, limit }) => {
      const db = provider.getProvider(connectionName);

      try {
        if (!db.capabilities.scheduledJobs) {
          return jsonResult({ supported: false, engine: db.engine });
        }
        return jsonResult(tabular(await db.listScheduledJobs(schema, pattern), limit));
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
