import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMonitorSql, type OracleCheck } from "./ora-monitor.tool.js";

// Todos os checks do enum (deve casar com o z.enum da tool).
const CHECKS: OracleCheck[] = [
  "active_queries", "all_activity", "long_transactions",
  "sessions_by_state", "connections_by_source", "connections_usage", "idle_in_transaction",
  "blocking_locks", "locks_detail", "deadlocks",
  "top_queries",
  "tablespace_usage", "segment_sizes", "table_sizes", "stale_stats",
  "cache_hit", "library_cache",
  "unused_indexes", "full_scans",
  "redo_stats", "log_switches",
  "dataguard_stats", "archive_dest",
];

test("todo check produz SQL não-vazio (nenhum cai no default)", () => {
  for (const c of CHECKS) {
    const sql = buildMonitorSql(c);
    assert.ok(sql.trim().length > 0, `check sem SQL: ${c}`);
  }
});

test("check desconhecido lança erro", () => {
  assert.throws(() => buildMonitorSql("nope" as OracleCheck), /desconhecido/);
});

test("top_queries respeita orderBy e limit", () => {
  assert.match(buildMonitorSql("top_queries", {}), /ORDER BY elapsed_time DESC/);
  assert.match(buildMonitorSql("top_queries", { orderBy: "mean" }), /ORDER BY elapsed_time \/ DECODE/);
  assert.match(buildMonitorSql("top_queries", { orderBy: "io" }), /ORDER BY buffer_gets DESC/);
  assert.match(buildMonitorSql("top_queries", { limit: 10 }), /FETCH FIRST 10 ROWS ONLY/);
  assert.match(buildMonitorSql("top_queries", {}), /FETCH FIRST 5 ROWS ONLY/);
});

test("idle_in_transaction usa idleMinutes em segundos", () => {
  assert.match(buildMonitorSql("idle_in_transaction", { idleMinutes: 15 }), /last_call_et > 900/);
  assert.match(buildMonitorSql("idle_in_transaction", {}), /last_call_et > 300/);
});
