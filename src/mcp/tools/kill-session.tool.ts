import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import type { Config } from "../../config.js";
import { jsonResult, errorResult, connectionArg, assertWritable } from "../shared.js";

// Ação destrutiva de firefighting: cancela (statement) ou termina (conexão) um backend.
// Mesma guarda read-only de run_sql — só roda com readOnly:false na conexão.
export function register(server: McpServer, provider: ProviderManager, cfg: Config): void {
  server.registerTool(
    "pg_kill_session",
    {
      title: "Encerrar sessão Postgres",
      description:
        "DESTRUTIVO. Cancela o statement ou derruba a sessão (ROLLBACK) pelo pid. " +
        "Só Postgres; exige readOnly:false na conexão.",
      inputSchema: z.object({
        connectionName: connectionArg,
        pid: z.number().int().describe("pid do backend (coluna pid de pg_monitor)."),
        mode: z
          .enum(["cancel", "terminate"])
          .default("cancel")
          .describe("cancel: só o statement (reversível). terminate: derruba a conexão."),
      }),
    },
    async ({ connectionName, pid, mode }) => {
      const db = provider.getProvider(connectionName);
      const name = provider.resolveConnectionName(connectionName);
      try {
        if (db.engine !== "postgres") {
          throw new Error(`pg_kill_session só suporta Postgres; a conexão usa engine '${db.engine}'.`);
        }
        assertWritable(cfg, name, "pg_kill_session");
        // pid é int validado por zod; mode vem de enum → SQL fixo, sem injeção.
        const fn = mode === "terminate" ? "pg_terminate_backend" : "pg_cancel_backend";
        return jsonResult({ mode, pid, ...(await db.runSql(`SELECT ${fn}(${pid}) AS ok`, 1)) });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
