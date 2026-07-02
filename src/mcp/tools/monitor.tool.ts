import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import type { DatabaseProvider } from "../../domain/database-provider.js";
import { jsonResult, errorResult, connectionArg } from "../shared.js";

// Monitoramento Postgres: uma tool, muitos "checks". Cada check é um
// SELECT fixo sobre pg_stat_*/pg_catalog (nada vem do usuário → seguro por construção).
// ponytail: SQL literal num mapa; só top_queries/checkpoints ramificam por versão.

export type MonitorCheck =
  | "active_queries" | "all_activity" | "long_transactions"
  | "sessions_by_state" | "connections_by_source" | "connections_usage" | "idle_in_transaction"
  | "blocking_locks" | "locks_detail" | "deadlocks"
  | "top_queries"
  | "vacuum_progress" | "dead_tuples" | "wraparound" | "autovacuum_config"
  | "table_sizes" | "database_sizes" | "cache_hit"
  | "unused_indexes" | "seq_scans" | "index_cache_hit"
  | "wal_stats" | "checkpoints"
  | "replication" | "replication_slots" | "publications" | "subscriptions";

interface MonitorOpts {
  limit?: number;
  orderBy?: "total" | "mean" | "max";
  idleMinutes?: number;
}

const PG17 = 170000;

// Checks estáticos (independem da versão). Os dinâmicos ficam no switch de buildMonitorSql.
const STATIC_SQL: Record<string, string> = {
  active_queries: `
    SELECT pid, usename, datname, now() - query_start AS running_for,
           wait_event_type, wait_event, left(query, 200) AS query,
           round(extract(epoch from (now() - query_start))::numeric, 2) AS sec,
           round(extract(epoch from (now() - state_change))::numeric, 2) AS state_change_sec
    FROM pg_stat_activity
    WHERE state = 'active' AND pid != pg_backend_pid()
    ORDER BY running_for DESC`,

  all_activity: `
    SELECT pid, usename, application_name, client_addr, datname, state,
           wait_event_type, wait_event, now() - xact_start AS xact_duration,
           now() - query_start AS query_duration, left(query, 150) AS query
    FROM pg_stat_activity
    WHERE state != 'idle' AND pid != pg_backend_pid()
    ORDER BY query_start ASC`,

  long_transactions: `
    SELECT pid, usename, datname, state, now() - xact_start AS xact_age, left(query, 150) AS query
    FROM pg_stat_activity
    WHERE xact_start IS NOT NULL
    ORDER BY xact_start ASC
    LIMIT 10`,

  sessions_by_state: `
    SELECT datname, state, count(*) AS total
    FROM pg_stat_activity
    WHERE pid != pg_backend_pid()
    GROUP BY datname, state
    ORDER BY total DESC`,

  connections_by_source: `
    SELECT usename, application_name, client_addr, state, count(*) AS total
    FROM pg_stat_activity
    WHERE pid != pg_backend_pid()
    GROUP BY usename, application_name, client_addr, state
    ORDER BY total DESC`,

  connections_usage: `
    SELECT (SELECT count(*) FROM pg_stat_activity) AS current_connections,
           setting::int AS max_connections,
           round((SELECT count(*) FROM pg_stat_activity)::numeric / setting::int * 100, 2) AS pct_used
    FROM pg_settings WHERE name = 'max_connections'`,

  blocking_locks: `
    SELECT pid, usename, wait_event_type, wait_event, now() - query_start AS duration,
           pg_blocking_pids(pid) AS blocked_by, left(query, 150) AS query
    FROM pg_stat_activity
    WHERE cardinality(pg_blocking_pids(pid)) > 0`,

  locks_detail: `
    SELECT l.locktype, l.mode, l.granted, l.pid, a.usename, a.state, c.relname,
           now() - a.query_start AS duration
    FROM pg_locks l
    LEFT JOIN pg_class c ON l.relation = c.oid
    LEFT JOIN pg_stat_activity a ON a.pid = l.pid
    WHERE l.pid != pg_backend_pid()
    ORDER BY l.granted, duration DESC NULLS LAST`,

  deadlocks: `
    SELECT datname, deadlocks, conflicts
    FROM pg_stat_database
    WHERE datname IS NOT NULL
    ORDER BY deadlocks DESC`,

  vacuum_progress: `
    SELECT p.pid, p.datname, c.relname, p.phase, p.heap_blks_total, p.heap_blks_scanned,
           round(p.heap_blks_scanned::numeric / NULLIF(p.heap_blks_total, 0) * 100, 2) AS pct_done,
           p.heap_blks_vacuumed, p.index_vacuum_count
    FROM pg_stat_progress_vacuum p
    JOIN pg_class c ON p.relid = c.oid`,

  dead_tuples: `
    SELECT schemaname, relname, n_live_tup, n_dead_tup,
           round(n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0) * 100, 2) AS dead_pct,
           last_vacuum, last_autovacuum, last_analyze, last_autoanalyze, autovacuum_count
    FROM pg_stat_user_tables
    WHERE n_dead_tup > 0
    ORDER BY n_dead_tup DESC
    LIMIT 20`,

  wraparound: `
    SELECT datname, age(datfrozenxid) AS xid_age, 2000000000 - age(datfrozenxid) AS xids_remaining
    FROM pg_database
    ORDER BY xid_age DESC`,

  autovacuum_config: `
    SELECT name, setting, unit
    FROM pg_settings
    WHERE name IN (
      'autovacuum', 'autovacuum_max_workers', 'autovacuum_naptime',
      'autovacuum_vacuum_scale_factor', 'autovacuum_vacuum_threshold',
      'autovacuum_vacuum_cost_limit', 'autovacuum_vacuum_cost_delay', 'autovacuum_freeze_max_age')`,

  // Tamanho + estimativa heurística de bloat (dead vs live). ponytail: sem pgstattuple;
  // para número exato de bloat, usar extensão pgstattuple_approx (não bloqueante).
  table_sizes: `
    SELECT schemaname, relname AS tablename,
           pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
           pg_size_pretty(pg_relation_size(relid)) AS table_size,
           pg_size_pretty(pg_indexes_size(relid)) AS indexes_size,
           n_dead_tup, n_live_tup
    FROM pg_stat_user_tables
    ORDER BY pg_total_relation_size(relid) DESC
    LIMIT 20`,

  database_sizes: `
    SELECT datname, pg_size_pretty(pg_database_size(datname)) AS size
    FROM pg_database
    ORDER BY pg_database_size(datname) DESC`,

  cache_hit: `
    SELECT datname, blks_hit, blks_read,
           round(blks_hit::numeric / NULLIF(blks_hit + blks_read, 0) * 100, 2) AS cache_hit_pct
    FROM pg_stat_database
    WHERE datname IS NOT NULL
    ORDER BY cache_hit_pct ASC`,

  unused_indexes: `
    SELECT schemaname, relname AS tablename, indexrelname, idx_scan,
           pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
    FROM pg_stat_user_indexes
    WHERE idx_scan = 0
    ORDER BY pg_relation_size(indexrelid) DESC`,

  seq_scans: `
    SELECT schemaname, relname AS tablename, seq_scan, seq_tup_read, idx_scan,
           round(seq_tup_read::numeric / NULLIF(seq_scan, 0), 2) AS avg_rows_per_seqscan, n_live_tup
    FROM pg_stat_user_tables
    WHERE seq_scan > 0
    ORDER BY seq_tup_read DESC
    LIMIT 20`,

  index_cache_hit: `
    SELECT schemaname, relname, indexrelname, idx_blks_hit, idx_blks_read,
           round(idx_blks_hit::numeric / NULLIF(idx_blks_hit + idx_blks_read, 0) * 100, 2) AS cache_hit_pct
    FROM pg_statio_user_indexes
    WHERE idx_blks_hit + idx_blks_read > 0
    ORDER BY cache_hit_pct ASC
    LIMIT 20`,

  wal_stats: `
    SELECT wal_records, wal_fpi, wal_bytes, wal_buffers_full, stats_reset
    FROM pg_stat_wal`,

  replication: `
    SELECT application_name, client_addr, state, sync_state,
           pg_wal_lsn_diff(sent_lsn, replay_lsn) AS replay_lag_bytes,
           write_lag, flush_lag, replay_lag
    FROM pg_stat_replication
    ORDER BY replay_lag_bytes DESC NULLS LAST`,

  replication_slots: `
    SELECT slot_name, slot_type, active, wal_status, restart_lsn, confirmed_flush_lsn,
           pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) AS retained_wal_bytes
    FROM pg_replication_slots
    ORDER BY retained_wal_bytes DESC NULLS LAST`,

  publications: `
    SELECT p.pubname, p.puballtables, pt.schemaname, pt.tablename
    FROM pg_publication p
    LEFT JOIN pg_publication_tables pt ON p.pubname = pt.pubname
    ORDER BY p.pubname, pt.tablename`,

  subscriptions: `
    SELECT subname, pid, received_lsn, latest_end_lsn, latest_end_time,
           now() - latest_end_time AS lag
    FROM pg_stat_subscription`,
};

const VERSION_CHECKS = new Set<MonitorCheck>(["top_queries", "checkpoints"]);

/** Monta o SQL fixo do check. Função pura para ser testável sem I/O. */
export function buildMonitorSql(check: MonitorCheck, opts: MonitorOpts = {}, versionNum = 0): string {
  if (check === "idle_in_transaction") {
    const mins = opts.idleMinutes ?? 5;
    return `
      SELECT pid, usename, application_name, client_addr,
             now() - state_change AS idle_since, left(query, 150) AS last_query
      FROM pg_stat_activity
      WHERE state = 'idle in transaction'
        AND now() - state_change > interval '${mins} minutes'
      ORDER BY idle_since DESC`;
  }

  if (check === "top_queries") {
    const limit = opts.limit ?? 5;
    const order = { total: "total_exec_time", mean: "mean_exec_time", max: "max_exec_time" }[opts.orderBy ?? "total"];
    // PG17 renomeou blk_read_time/blk_write_time → shared_blk_read_time/shared_blk_write_time.
    const readCol = versionNum >= PG17 ? "shared_blk_read_time" : "blk_read_time";
    const writeCol = versionNum >= PG17 ? "shared_blk_write_time" : "blk_write_time";
    return `
      SELECT queryid, query, calls, round(mean_exec_time::numeric, 2) AS avg_ms,
             round(${readCol}::numeric, 2) AS blk_read_ms,
             round(${writeCol}::numeric, 2) AS blk_write_ms,
             round((${readCol} / NULLIF(calls, 0))::numeric, 2) AS avg_blk_read_ms,
             shared_blks_hit, shared_blks_read,
             round(shared_blks_hit::numeric / NULLIF(shared_blks_hit + shared_blks_read, 0) * 100, 2) AS cache_hit_pct
      FROM pg_stat_statements
      ORDER BY ${order} DESC
      LIMIT ${limit}`;
  }

  if (check === "checkpoints") {
    // PG17 moveu as stats de checkpoint de pg_stat_bgwriter → pg_stat_checkpointer.
    return versionNum >= PG17
      ? `SELECT num_timed AS checkpoints_timed, num_requested AS checkpoints_req,
                write_time, sync_time, buffers_written
         FROM pg_stat_checkpointer`
      : `SELECT checkpoints_timed, checkpoints_req, checkpoint_write_time, checkpoint_sync_time,
                buffers_checkpoint, buffers_clean, buffers_backend
         FROM pg_stat_bgwriter`;
  }

  const sql = STATIC_SQL[check];
  if (!sql) throw new Error(`check desconhecido: ${check}`);
  return sql;
}

async function pgVersionNum(db: DatabaseProvider): Promise<number> {
  const r = await db.runSql("SELECT current_setting('server_version_num')::int AS v", 1);
  return Number(r.rows?.[0]?.v ?? 0);
}

const CHECK_DESC =
  "Métrica a coletar. Atividade: active_queries, all_activity, long_transactions. " +
  "Sessões: sessions_by_state, connections_by_source, connections_usage, idle_in_transaction. " +
  "Locks: blocking_locks, locks_detail, deadlocks. Queries: top_queries (exige extensão pg_stat_statements). " +
  "Vacuum: vacuum_progress, dead_tuples, wraparound, autovacuum_config. " +
  "Storage: table_sizes, database_sizes, cache_hit. Índices: unused_indexes, seq_scans, index_cache_hit. " +
  "WAL: wal_stats, checkpoints. Replicação: replication, replication_slots, publications, subscriptions.";

export function register(server: McpServer, provider: ProviderManager): void {
  server.registerTool(
    "pg_monitor",
    {
      title: "Monitorar Postgres",
      description:
        "Monitoramento Postgres (somente leitura): sessões, locks, vacuum, bloat, índices, " +
        "cache hit, WAL/checkpoints e replicação. Escolha a métrica pelo parâmetro 'check'. Só engine Postgres.",
      inputSchema: z.object({
        connectionName: connectionArg,
        check: z
          .enum([
            "active_queries", "all_activity", "long_transactions",
            "sessions_by_state", "connections_by_source", "connections_usage", "idle_in_transaction",
            "blocking_locks", "locks_detail", "deadlocks",
            "top_queries",
            "vacuum_progress", "dead_tuples", "wraparound", "autovacuum_config",
            "table_sizes", "database_sizes", "cache_hit",
            "unused_indexes", "seq_scans", "index_cache_hit",
            "wal_stats", "checkpoints",
            "replication", "replication_slots", "publications", "subscriptions",
          ])
          .describe(CHECK_DESC),
        limit: z.number().int().positive().optional().describe("Só top_queries: nº de queries (default 5)."),
        orderBy: z
          .enum(["total", "mean", "max"])
          .optional()
          .describe("Só top_queries: total (I/O+CPU agregado, default), mean (média por chamada) ou max (pior tempo)."),
        idleMinutes: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Só idle_in_transaction: minutos mínimos ocioso (default 5)."),
      }),
    },
    async ({ connectionName, check, limit, orderBy, idleMinutes }) => {
      const db = provider.getProvider(connectionName);
      try {
        if (db.engine !== "postgres") {
          throw new Error(`pg_monitor só suporta Postgres; a conexão usa engine '${db.engine}'.`);
        }
        const versionNum = VERSION_CHECKS.has(check as MonitorCheck) ? await pgVersionNum(db) : 0;
        const sql = buildMonitorSql(check as MonitorCheck, { limit, orderBy, idleMinutes }, versionNum);
        return jsonResult({ check, ...(await db.runSql(sql, 1000)) });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
