import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import type { Config } from "../../config.js";
import { isWriteStatement } from "../../domain/types.js";
import { jsonResult, errorResult , connectionArg } from "../shared.js";

// Compõe a guarda read-only (política DB-agnóstica) com a execução crua do db.
export function register(server: McpServer, provider: ProviderManager, cfg: Config): void {
  server.registerTool(
    "run_sql",
    {
      title: "Executar SQL",
      description:
        "Executa SQL. Por padrão (READ_ONLY) só permite SELECT/WITH; escrita exige READ_ONLY=false. Limita linhas retornadas.",
      inputSchema: z.object({
      connectionName: connectionArg,
      sql: z.string().describe("Statement SQL a executar."),
        maxRows: z.number().int().positive().optional().describe("Máximo de linhas a retornar (default 200)."),
      }),
    },
    async ({ connectionName, sql, maxRows }) => {
      const db = provider.getProvider(connectionName);

      try {
        // ponytail: guarda por primeiro token, não parser SQL. Teto conhecido — para
        // bloqueio forte, use um usuário do banco read-only (GRANT SELECT).
        if (cfg.readOnly && isWriteStatement(sql)) {
          throw new Error(
            "READ_ONLY ativo: apenas SELECT/WITH são permitidos. Defina READ_ONLY=false para habilitar escrita.",
          );
        }
        return jsonResult(await db.runSql(sql, maxRows));
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
