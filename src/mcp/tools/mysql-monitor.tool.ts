import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import { jsonResult, errorResult, connectionArg } from "../shared.js";

export type MysqlMonitorCheck =
  | "active_queries" | "all_activity" | "long_transactions"
  | "blocking_locks" | "top_queries" | "table_sizes" | "engine_status";

const CHECKS: Record<MysqlMonitorCheck, () => string> = {
  active_queries: () => `
    SELECT id, user, host, db, command, time, state, info 
    FROM information_schema.processlist 
    WHERE command != 'Sleep' AND info IS NOT NULL
    ORDER BY time DESC
  `,
  all_activity: () => `
    SELECT id, user, host, db, command, time, state, info 
    FROM information_schema.processlist 
    ORDER BY time DESC
  `,
  long_transactions: () => `
    SELECT trx_id, trx_state, trx_started, trx_query, trx_operation_state, trx_tables_in_use, trx_tables_locked, trx_rows_locked, trx_rows_modified 
    FROM information_schema.innodb_trx 
    WHERE trx_state = 'RUNNING' AND trx_started < NOW() - INTERVAL 1 MINUTE
    ORDER BY trx_started ASC
  `,
  blocking_locks: () => `
    SELECT r.trx_id waiting_trx_id, r.trx_mysql_thread_id waiting_thread,
           r.trx_query waiting_query,
           b.trx_id blocking_trx_id, b.trx_mysql_thread_id blocking_thread,
           b.trx_query blocking_query
    FROM information_schema.innodb_lock_waits w
    INNER JOIN information_schema.innodb_trx b ON b.trx_id = w.blocking_trx_id
    INNER JOIN information_schema.innodb_trx r ON r.trx_id = w.requesting_trx_id
  `,
  top_queries: () => `
    SELECT schema_name, digest_text, count_star, sum_timer_wait/1000000000000 as sum_time_s, min_timer_wait/1000000000000 as min_time_s, avg_timer_wait/1000000000000 as avg_time_s, max_timer_wait/1000000000000 as max_time_s 
    FROM performance_schema.events_statements_summary_by_digest 
    ORDER BY sum_timer_wait DESC LIMIT 20
  `,
  table_sizes: () => `
    SELECT table_schema, table_name, 
           round(((data_length + index_length) / 1024 / 1024), 2) as size_mb 
    FROM information_schema.TABLES 
    WHERE table_type = 'BASE TABLE'
    ORDER BY (data_length + index_length) DESC LIMIT 50
  `,
  engine_status: () => "SHOW ENGINE INNODB STATUS"
};

export function register(server: McpServer, provider: ProviderManager): void {
  server.registerTool(
    "mysql_monitor",
    {
      title: "Monitoramento MySQL",
      description: "Executa checks predefinidos e seguros para investigar gargalos e incidentes no MySQL.",
      inputSchema: z.object({
        connectionName: connectionArg,
        check: z.enum([
          "active_queries", "all_activity", "long_transactions",
          "blocking_locks", "top_queries", "table_sizes", "engine_status"
        ]).describe("Nome do check a executar."),
      }),
    },
    async ({ connectionName, check }) => {
      const db = provider.getProvider(connectionName);
      try {
        if (db.engine !== "mysql") {
          throw new Error(`mysql_monitor só suporta MySQL; a conexão usa engine '${db.engine}'.`);
        }
        const sqlFn = CHECKS[check as MysqlMonitorCheck];
        if (!sqlFn) throw new Error(`Check desconhecido: ${check}`);
        return jsonResult(await db.runSql(sqlFn(), 100));
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
