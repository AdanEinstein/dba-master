import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import type { Config } from "../../config.js";
import { jsonResult, errorResult, connectionArg, assertWritable } from "../shared.js";

export function register(server: McpServer, provider: ProviderManager, cfg: Config): void {
  server.registerTool(
    "mysql_kill_session",
    {
      title: "Encerrar sessão MySQL",
      description:
        "DESTRUTIVO. Cancela a query ou derruba a sessão pelo connection_id. " +
        "Só MySQL; exige readOnly:false na conexão.",
      inputSchema: z.object({
        connectionName: connectionArg,
        connectionId: z.number().int().describe("ID da conexão (coluna id de mysql_monitor active_queries)."),
        mode: z
          .enum(["query", "connection"])
          .default("connection")
          .describe("query: cancela só a query. connection: derruba a sessão inteira."),
      }),
    },
    async ({ connectionName, connectionId, mode }) => {
      const db = provider.getProvider(connectionName);
      const name = provider.resolveConnectionName(connectionName);
      try {
        if (db.engine !== "mysql") {
          throw new Error(`mysql_kill_session só suporta MySQL; a conexão usa engine '${db.engine}'.`);
        }
        assertWritable(cfg, name, "mysql_kill_session");
        const sql = mode === "query" ? `KILL QUERY ${connectionId}` : `KILL CONNECTION ${connectionId}`;
        return jsonResult({ mode, connectionId, ...(await db.runSql(sql, 1)) });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
