import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import type { Config } from "../../config.js";
import { jsonResult, errorResult, connectionArg, assertWritable } from "../shared.js";

// Ação destrutiva de firefighting: cancela o SQL ou derruba a sessão (sid,serial#).
// Mesma guarda read-only de run_sql — só roda com readOnly:false na conexão.
// ponytail: exige privilégio ALTER SYSTEM no usuário do banco.
export function register(server: McpServer, provider: ProviderManager, cfg: Config): void {
  server.registerTool(
    "ora_kill_session",
    {
      title: "Encerrar sessão Oracle",
      description:
        "DESTRUTIVO. Cancela o SQL ou derruba a sessão (ROLLBACK) por sid+serial#. " +
        "Só Oracle; exige readOnly:false na conexão e ALTER SYSTEM.",
      inputSchema: z.object({
        connectionName: connectionArg,
        sid: z.number().int().describe("sid da sessão (coluna sid de ora_monitor)."),
        serial: z.number().int().describe("serial# da sessão (coluna serial de ora_monitor)."),
        mode: z
          .enum(["cancel", "kill"])
          .default("kill")
          .describe("cancel: só o SQL em curso (19c+, reversível). kill: derruba a sessão."),
      }),
    },
    async ({ connectionName, sid, serial, mode }) => {
      const db = provider.getProvider(connectionName);
      const name = provider.resolveConnectionName(connectionName);
      try {
        if (db.engine !== "oracle") {
          throw new Error(`ora_kill_session só suporta Oracle; a conexão usa engine '${db.engine}'.`);
        }
        assertWritable(cfg, name, "ora_kill_session");
        // sid/serial são int validados por zod; mode vem de enum → SQL fixo, sem injeção.
        const sql =
          mode === "cancel"
            ? `ALTER SYSTEM CANCEL SQL '${sid}, ${serial}'`
            : `ALTER SYSTEM KILL SESSION '${sid},${serial}' IMMEDIATE`;
        return jsonResult({ mode, sid, serial, ...(await db.runSql(sql, 1)) });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
