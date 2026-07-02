Monitore e diagnostique um banco **Postgres** usando as tools MCP do
**dba-master** (`pg_monitor` e, quando autorizado, `pg_kill_session`). Não chute
métricas — colete-as pelas tools antes de concluir.

## Demanda

$ARGUMENTS

## Como monitorar

As tools retornam **JSON estruturado**. `pg_monitor` é somente leitura; escolha a
métrica pelo parâmetro `check`.

0. **Selecione o banco.** Rode `list_connections`. Se houver mais de uma conexão, **pergunte ao usuário** qual monitorar e passe o nome em `connectionName`. `pg_monitor`/`pg_kill_session` só funcionam em conexões Postgres.
1. **Comece pelo sintoma.** Escolha o `check` conforme a queixa:
   - App travado / lento agora → `active_queries`, depois `blocking_locks` (quem bloqueia quem).
   - "Conexões esgotadas" → `connections_usage`, `connections_by_source` (connection leak por camada), `idle_in_transaction`.
   - Escrita/DDL travada → `locks_detail`, `blocking_locks`, `deadlocks`.
   - Tabela inchada / autovacuum atrasado → `dead_tuples`, `vacuum_progress`, `autovacuum_config`.
   - Banco read-only iminente → `wraparound` (**crítico** se `xids_remaining` cai perto de zero).
   - Query lenta recorrente → `top_queries` (exige extensão `pg_stat_statements`); use `orderBy` = `total` (I/O+CPU agregado), `mean` (média) ou `max` (pior pico).
   - Disco/IOPS altos → `cache_hit`, `index_cache_hit`, `table_sizes`, `wal_stats`, `checkpoints`.
   - Índices → `unused_indexes` (candidatos a DROP — nunca dropar PK/UNIQUE), `seq_scans` (candidatos a indexar).
   - Réplica atrasada / storage enchendo → `replication`, `replication_slots` (slot `active=false` retém WAL), `publications`, `subscriptions`.
2. **Correlacione.** Ex.: transação longa (`long_transactions`) explica dead tuples que não são limpos e WAL retido; `idle_in_transaction` explica locks presos.
3. **Aja só com autorização explícita.** Para matar uma sessão problemática use `pg_kill_session(pid, mode)`: `cancel` (cancela o statement, reversível) antes de `terminate` (derruba a conexão, ROLLBACK). Exige `READ_ONLY=false` na conexão — se recusar, oriente o usuário a ajustar a conexão. Confirme o `pid` (de `active_queries`/`blocking_locks`) e o impacto antes.

## Como responder
1. Fundamente cada diagnóstico no JSON real das tools (cite pid, tabela, lag, pct).
2. Aponte a causa provável e o risco; se faltar dado, indique o próximo `check` sem inventar.
3. Feche sempre passando pelo gate da skill `dba-wiring`.
