import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMonitorSql, type MonitorCheck } from "./monitor.tool.js";

// Todos os checks do enum (deve casar com o z.enum da tool).
const CHECKS: MonitorCheck[] = [
  "active_queries", "all_activity", "long_transactions",
  "sessions_by_state", "connections_by_source", "connections_usage", "idle_in_transaction",
  "blocking_locks", "locks_detail", "deadlocks",
  "top_queries",
  "vacuum_progress", "dead_tuples", "wraparound", "autovacuum_config",
  "table_sizes", "database_sizes", "cache_hit",
  "unused_indexes", "seq_scans", "index_cache_hit",
  "wal_stats", "checkpoints",
  "replication", "replication_slots", "publications", "subscriptions",
];

test("todo check produz SQL não-vazio (nenhum cai no default)", () => {
  for (const c of CHECKS) {
    const sql = buildMonitorSql(c, {}, 170000);
    assert.ok(sql.trim().length > 0, `check sem SQL: ${c}`);
  }
});

test("check desconhecido lança erro", () => {
  assert.throws(() => buildMonitorSql("nope" as MonitorCheck), /desconhecido/);
});

test("top_queries usa colunas por versão", () => {
  assert.match(buildMonitorSql("top_queries", {}, 160000), /\bblk_read_time\b/);
  assert.doesNotMatch(buildMonitorSql("top_queries", {}, 160000), /shared_blk_read_time/);
  assert.match(buildMonitorSql("top_queries", {}, 170000), /shared_blk_read_time/);
});

test("top_queries respeita orderBy e limit", () => {
  assert.match(buildMonitorSql("top_queries", { orderBy: "mean", limit: 10 }, 170000), /ORDER BY mean_exec_time/);
  assert.match(buildMonitorSql("top_queries", { orderBy: "mean", limit: 10 }, 170000), /LIMIT 10/);
  assert.match(buildMonitorSql("top_queries", {}, 170000), /ORDER BY total_exec_time/);
});

test("checkpoints ramifica pg_stat_bgwriter vs pg_stat_checkpointer", () => {
  assert.match(buildMonitorSql("checkpoints", {}, 160000), /pg_stat_bgwriter/);
  assert.match(buildMonitorSql("checkpoints", {}, 170000), /pg_stat_checkpointer/);
});

test("idle_in_transaction usa idleMinutes", () => {
  assert.match(buildMonitorSql("idle_in_transaction", { idleMinutes: 15 }), /interval '15 minutes'/);
  assert.match(buildMonitorSql("idle_in_transaction", {}), /interval '5 minutes'/);
});
