import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import { jsonResult, errorResult, connectionArg } from "../shared.js";

// Monitoramento Oracle: uma tool, muitos "checks". Cada check é um SELECT fixo
// sobre v$/dba_* (nada vem do usuário → seguro por construção).
// ponytail: SQL literal num mapa; só idle_in_transaction/top_queries são dinâmicos.
// Sem detecção de versão (as views usadas são estáveis de 12c a 23c) — diferente do pg_monitor.
// Exige SELECT_CATALOG_ROLE (ou grants nas v$/dba_*); rows voltam com chaves em UPPERCASE.

export type OracleCheck =
  | "active_queries" | "all_activity" | "long_transactions"
  | "sessions_by_state" | "connections_by_source" | "connections_usage" | "idle_in_transaction"
  | "blocking_locks" | "locks_detail" | "deadlocks"
  | "top_queries"
  | "tablespace_usage" | "segment_sizes" | "table_sizes" | "stale_stats"
  | "cache_hit" | "library_cache"
  | "unused_indexes" | "full_scans"
  | "redo_stats" | "log_switches"
  | "dataguard_stats" | "archive_dest";

interface MonitorOpts {
  limit?: number;
  orderBy?: "total" | "mean" | "io";
  idleMinutes?: number;
}

// Checks estáticos (sem parâmetro). Os dinâmicos ficam no switch de buildMonitorSql.
const STATIC_SQL: Record<string, string> = {
  active_queries: `
    SELECT s.sid, s.serial# AS serial, s.username, s.program, s.machine, s.status,
           s.event, s.wait_class, s.seconds_in_wait, s.last_call_et AS active_sec,
           s.sql_id, SUBSTR(q.sql_text, 1, 200) AS sql_text
    FROM v$session s
    LEFT JOIN v$sqlarea q ON q.sql_id = s.sql_id
    WHERE s.status = 'ACTIVE' AND s.type = 'USER'
      AND s.sid != SYS_CONTEXT('userenv', 'sid')
    ORDER BY s.last_call_et DESC`,

  all_activity: `
    SELECT s.sid, s.serial# AS serial, s.username, s.program, s.machine, s.osuser,
           s.status, s.event, s.wait_class, s.seconds_in_wait, s.last_call_et,
           s.sql_id, SUBSTR(q.sql_text, 1, 150) AS sql_text
    FROM v$session s
    LEFT JOIN v$sqlarea q ON q.sql_id = s.sql_id
    WHERE s.type = 'USER' AND s.sid != SYS_CONTEXT('userenv', 'sid')
    ORDER BY s.status, s.last_call_et DESC`,

  long_transactions: `
    SELECT s.sid, s.serial# AS serial, s.username, s.program, t.start_time,
           ROUND((SYSDATE - TO_DATE(t.start_time, 'MM/DD/YY HH24:MI:SS')) * 86400) AS xact_age_sec,
           t.used_ublk AS undo_blocks, t.used_urec AS undo_records,
           s.sql_id, SUBSTR(q.sql_text, 1, 150) AS sql_text
    FROM v$transaction t
    JOIN v$session s ON s.taddr = t.addr
    LEFT JOIN v$sqlarea q ON q.sql_id = s.sql_id
    ORDER BY t.start_time ASC`,

  sessions_by_state: `
    SELECT username, status, type, count(*) AS total
    FROM v$session
    WHERE sid != SYS_CONTEXT('userenv', 'sid')
    GROUP BY username, status, type
    ORDER BY total DESC`,

  connections_by_source: `
    SELECT username, program, machine, osuser, status, count(*) AS total
    FROM v$session
    WHERE type = 'USER' AND sid != SYS_CONTEXT('userenv', 'sid')
    GROUP BY username, program, machine, osuser, status
    ORDER BY total DESC`,

  connections_usage: `
    SELECT resource_name, current_utilization, max_utilization,
           limit_value AS resource_limit,
           CASE WHEN limit_value = 'UNLIMITED' OR limit_value = '0' THEN NULL
                ELSE ROUND(current_utilization / TO_NUMBER(limit_value) * 100, 2) END AS pct_used
    FROM v$resource_limit
    WHERE resource_name IN ('sessions', 'processes')`,

  blocking_locks: `
    SELECT b.sid AS blocked_sid, b.serial# AS blocked_serial, b.username AS blocked_user,
           b.event AS blocked_event, b.seconds_in_wait AS waited_sec,
           b.blocking_session AS blocking_sid, h.serial# AS blocking_serial,
           h.username AS blocking_user, h.status AS blocking_status,
           SUBSTR(hq.sql_text, 1, 150) AS blocking_sql
    FROM v$session b
    LEFT JOIN v$session h ON h.sid = b.blocking_session
    LEFT JOIN v$sqlarea hq ON hq.sql_id = h.sql_id
    WHERE b.blocking_session IS NOT NULL
    ORDER BY b.seconds_in_wait DESC`,

  locks_detail: `
    SELECT l.type, l.lmode, l.request, l.block, s.sid, s.serial# AS serial,
           s.username, s.status, o.owner AS obj_owner, o.object_name, o.object_type
    FROM v$lock l
    JOIN v$session s ON s.sid = l.sid
    LEFT JOIN dba_objects o ON o.object_id = l.id1 AND l.type = 'TM'
    WHERE s.sid != SYS_CONTEXT('userenv', 'sid')
    ORDER BY l.block DESC, l.ctime DESC`,

  deadlocks: `
    SELECT name, value AS total
    FROM v$sysstat
    WHERE name = 'enqueue deadlocks'`,

  tablespace_usage: `
    SELECT tablespace_name,
           ROUND(used_space * 8192 / 1024 / 1024, 2) AS used_mb,
           ROUND(tablespace_size * 8192 / 1024 / 1024, 2) AS size_mb,
           ROUND(used_percent, 2) AS used_pct
    FROM dba_tablespace_usage_metrics
    ORDER BY used_percent DESC`,

  segment_sizes: `
    SELECT owner, segment_name, segment_type,
           ROUND(SUM(bytes) / 1024 / 1024, 2) AS size_mb
    FROM dba_segments
    GROUP BY owner, segment_name, segment_type
    ORDER BY SUM(bytes) DESC
    FETCH FIRST 20 ROWS ONLY`,

  table_sizes: `
    SELECT sg.owner, sg.segment_name AS table_name,
           ROUND(SUM(sg.bytes) / 1024 / 1024, 2) AS size_mb, t.num_rows, t.last_analyzed
    FROM dba_segments sg
    LEFT JOIN dba_tables t ON t.owner = sg.owner AND t.table_name = sg.segment_name
    WHERE sg.segment_type = 'TABLE'
    GROUP BY sg.owner, sg.segment_name, t.num_rows, t.last_analyzed
    ORDER BY SUM(sg.bytes) DESC
    FETCH FIRST 20 ROWS ONLY`,

  // Análogo Oracle de dead_tuples/vacuum-lag: estatísticas velhas → planos ruins.
  stale_stats: `
    SELECT owner, table_name, stale_stats, last_analyzed, num_rows
    FROM dba_tab_statistics
    WHERE stale_stats = 'YES' AND object_type = 'TABLE'
    ORDER BY last_analyzed ASC NULLS FIRST
    FETCH FIRST 50 ROWS ONLY`,

  cache_hit: `
    SELECT ROUND((1 - (pr.value / NULLIF(dbg.value + cg.value, 0))) * 100, 2) AS buffer_cache_hit_pct,
           dbg.value AS db_block_gets, cg.value AS consistent_gets, pr.value AS physical_reads
    FROM (SELECT value FROM v$sysstat WHERE name = 'physical reads') pr,
         (SELECT value FROM v$sysstat WHERE name = 'db block gets') dbg,
         (SELECT value FROM v$sysstat WHERE name = 'consistent gets') cg`,

  library_cache: `
    SELECT namespace, gets, ROUND(gethitratio * 100, 2) AS get_hit_pct,
           pins, ROUND(pinhitratio * 100, 2) AS pin_hit_pct, reloads, invalidations
    FROM v$librarycache
    ORDER BY namespace`,

  // dba_index_usage exige 12.2+. Nunca dropar índice de PK/UNIQUE mesmo com acesso 0.
  unused_indexes: `
    SELECT owner, name AS index_name, total_access_count, total_exec_count, last_used
    FROM dba_index_usage
    WHERE total_access_count = 0
    ORDER BY owner, name
    FETCH FIRST 50 ROWS ONLY`,

  full_scans: `
    SELECT name, value
    FROM v$sysstat
    WHERE name IN ('table scans (long tables)', 'table scans (short tables)',
                   'table scans (rowid ranges)', 'table fetch by rowid')
    ORDER BY name`,

  redo_stats: `
    SELECT name, value
    FROM v$sysstat
    WHERE name IN ('redo size', 'redo writes', 'redo entries', 'redo log space requests')
    ORDER BY name`,

  log_switches: `
    SELECT TO_CHAR(TRUNC(first_time, 'HH24'), 'YYYY-MM-DD HH24:MI') AS hour, count(*) AS switches
    FROM v$log_history
    WHERE first_time > SYSDATE - 1
    GROUP BY TRUNC(first_time, 'HH24')
    ORDER BY hour DESC`,

  dataguard_stats: `
    SELECT name, value, unit, time_computed
    FROM v$dataguard_stats
    ORDER BY name`,

  archive_dest: `
    SELECT dest_id, status, database_mode, recovery_mode, protection_mode,
           destination, error
    FROM v$archive_dest_status
    WHERE status != 'INACTIVE'
    ORDER BY dest_id`,
};

/** Monta o SQL fixo do check. Função pura para ser testável sem I/O. */
export function buildMonitorSql(check: OracleCheck, opts: MonitorOpts = {}): string {
  if (check === "idle_in_transaction") {
    const secs = (opts.idleMinutes ?? 5) * 60;
    return `
      SELECT s.sid, s.serial# AS serial, s.username, s.program, s.machine,
             s.last_call_et AS idle_sec, t.start_time AS xact_start,
             s.sql_id, SUBSTR(q.sql_text, 1, 150) AS last_sql
      FROM v$transaction t
      JOIN v$session s ON s.taddr = t.addr
      LEFT JOIN v$sqlarea q ON q.sql_id = s.prev_sql_id
      WHERE s.status = 'INACTIVE' AND s.last_call_et > ${secs}
      ORDER BY s.last_call_et DESC`;
  }

  if (check === "top_queries") {
    const limit = opts.limit ?? 5;
    // total = tempo agregado; mean = tempo médio por execução; io = buffer gets.
    const order = {
      total: "elapsed_time",
      mean: "elapsed_time / DECODE(executions, 0, 1, executions)",
      io: "buffer_gets",
    }[opts.orderBy ?? "total"];
    return `
      SELECT sql_id, executions,
             ROUND(elapsed_time / 1000, 2) AS elapsed_ms,
             ROUND(cpu_time / 1000, 2) AS cpu_ms,
             ROUND(elapsed_time / DECODE(executions, 0, 1, executions) / 1000, 2) AS avg_ms,
             buffer_gets, disk_reads, rows_processed AS rows_out,
             SUBSTR(sql_text, 1, 200) AS sql_text
      FROM v$sqlarea
      ORDER BY ${order} DESC
      FETCH FIRST ${limit} ROWS ONLY`;
  }

  const sql = STATIC_SQL[check];
  if (!sql) throw new Error(`check desconhecido: ${check}`);
  return sql;
}

const CHECK_DESC =
  "Métrica a coletar. Atividade: active_queries, all_activity, long_transactions. " +
  "Sessões: sessions_by_state, connections_by_source, connections_usage, idle_in_transaction. " +
  "Locks: blocking_locks, locks_detail, deadlocks. Queries: top_queries (v$sqlarea). " +
  "Storage: tablespace_usage, segment_sizes, table_sizes, stale_stats. " +
  "Cache: cache_hit, library_cache. Índices: unused_indexes (12.2+), full_scans. " +
  "Redo: redo_stats, log_switches. Data Guard: dataguard_stats, archive_dest.";

export function register(server: McpServer, provider: ProviderManager): void {
  server.registerTool(
    "ora_monitor",
    {
      title: "Monitorar Oracle",
      description:
        "Monitoramento Oracle (somente leitura): sessões, locks, top SQL, tablespace/segments, " +
        "cache hit, índices, redo e Data Guard. Escolha a métrica pelo parâmetro 'check'. Só engine Oracle. " +
        "Exige SELECT_CATALOG_ROLE (v$/dba_*).",
      inputSchema: z.object({
        connectionName: connectionArg,
        check: z
          .enum([
            "active_queries", "all_activity", "long_transactions",
            "sessions_by_state", "connections_by_source", "connections_usage", "idle_in_transaction",
            "blocking_locks", "locks_detail", "deadlocks",
            "top_queries",
            "tablespace_usage", "segment_sizes", "table_sizes", "stale_stats",
            "cache_hit", "library_cache",
            "unused_indexes", "full_scans",
            "redo_stats", "log_switches",
            "dataguard_stats", "archive_dest",
          ])
          .describe(CHECK_DESC),
        limit: z.number().int().positive().optional().describe("Só top_queries: nº de queries (default 5)."),
        orderBy: z
          .enum(["total", "mean", "io"])
          .optional()
          .describe("Só top_queries: total (elapsed agregado, default), mean (média por execução) ou io (buffer gets)."),
        idleMinutes: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Só idle_in_transaction: minutos mínimos ocioso com transação aberta (default 5)."),
      }),
    },
    async ({ connectionName, check, limit, orderBy, idleMinutes }) => {
      const db = provider.getProvider(connectionName);
      try {
        if (db.engine !== "oracle") {
          throw new Error(`ora_monitor só suporta Oracle; a conexão usa engine '${db.engine}'.`);
        }
        const sql = buildMonitorSql(check as OracleCheck, { limit, orderBy, idleMinutes });
        return jsonResult({ check, ...(await db.runSql(sql, 1000)) });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
