import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { DatabaseProvider } from "../../domain/database-provider.js";
import { jsonResult, errorResult, schemaArg, patternArg } from "../shared.js";

export function register(server: McpServer, provider: DatabaseProvider): void {
  server.registerTool(
    "list_schedulers_jobs",
    {
      title: "Listar jobs do scheduler",
      description:
        "Lista jobs agendados (ação, agendamento, estado, próxima execução). O sistema de jobs varia por banco.",
      inputSchema: z.object({ schema: schemaArg, pattern: patternArg }),
    },
    async ({ schema, pattern }) => {
      try {
        if (!provider.capabilities.scheduledJobs) {
          return jsonResult({ supported: false, engine: provider.engine, jobs: [] });
        }
        return jsonResult({ supported: true, jobs: await provider.listScheduledJobs(schema, pattern) });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
