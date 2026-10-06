import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import type { Config } from "../../config.js";
import { isWriteStatement } from "../../domain/types.js";
import { jsonResult, errorResult, connectionArg, tabular, assertWritable } from "../shared.js";

// Compõe a guarda read-only (política DB-agnóstica) com a execução crua do db.
export function register(server: McpServer, provider: ProviderManager, cfg: Config): void {
  server.registerTool(
    "run_sql",
    {
      title: "Executar SQL",
      description:
        "Executa SQL. Por padrão só permite SELECT/WITH; escrita exige readOnly:false na conexão.",
      inputSchema: z.object({
      connectionName: connectionArg,
      sql: z.string().describe("Statement SQL a executar."),
        maxRows: z.number().int().positive().optional().describe("Máximo de linhas a retornar (default 200)."),
      }),
    },
    async ({ connectionName, sql, maxRows }) => {
      const db = provider.getProvider(connectionName);
      const name = provider.resolveConnectionName(connectionName);

      try {
        // ponytail: guarda por primeiro token, não parser SQL. Teto conhecido — para
        // bloqueio forte, use um usuário do banco read-only (GRANT SELECT).
        // readOnly é por conexão (default true).
        if (isWriteStatement(sql)) assertWritable(cfg, name, "escrita (só SELECT/WITH/EXPLAIN)");
        const r = await db.runSql(sql, maxRows);
        // Sem rows = DML/DDL. Com rows: colunar, e truncated se bateu no teto do driver.
        if (!r.rows) return jsonResult({ rowCount: r.rowCount });
        const cap = maxRows ?? 200;
        return jsonResult({ ...tabular(r.rows, cap), ...(r.rows.length >= cap ? { truncated: true } : {}) });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
