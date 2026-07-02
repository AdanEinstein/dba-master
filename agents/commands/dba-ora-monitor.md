Monitore e diagnostique um banco **Oracle** em produção usando as tools MCP do
**dba-master** (`ora_monitor` e, quando autorizado, `ora_kill_session`). Não chute
métricas — colete-as pelas tools antes de concluir.

## Demanda

$ARGUMENTS

## Como monitorar

As tools retornam **JSON estruturado** (chaves em UPPERCASE, padrão Oracle).
`ora_monitor` é somente leitura; escolha a métrica pelo parâmetro `check`. As views
`v$`/`dba_*` exigem `SELECT_CATALOG_ROLE` — se vier `ORA-00942`, oriente o usuário a
conceder o grant.

0. **Selecione o banco.** Rode `list_connections`. Se houver mais de uma conexão, **pergunte ao usuário** qual monitorar e passe o nome em `connectionName`. `ora_monitor`/`ora_kill_session` só funcionam em conexões Oracle.
1. **Comece pelo sintoma.** Escolha o `check` conforme a queixa:
   - App travado / lento agora → `active_queries`, depois `blocking_locks` (quem bloqueia quem, por sid).
   - "Sessões/processos esgotados" → `connections_usage`, `connections_by_source` (leak por program/machine/osuser), `idle_in_transaction`.
   - Escrita/DDL travada → `locks_detail`, `blocking_locks`, `deadlocks` (contador cumulativo `enqueue deadlocks`).
   - Transação aberta há muito tempo → `long_transactions` (segura undo e trava manutenção).
   - Query lenta recorrente → `top_queries`; use `orderBy` = `total` (elapsed agregado), `mean` (média por execução) ou `io` (buffer gets).
   - Planos ruins / estatísticas velhas → `stale_stats` (candidatas a `DBMS_STATS`).
   - Disco/IOPS altos → `cache_hit`, `library_cache`, `redo_stats`, `log_switches`.
   - Storage enchendo → `tablespace_usage` (used_pct), `segment_sizes`, `table_sizes`.
   - Índices → `unused_indexes` (candidatos a DROP — nunca dropar PK/UNIQUE; exige 12.2+), `full_scans`.
   - Standby atrasado → `dataguard_stats` (apply/transport lag), `archive_dest` (destino em erro).
2. **Correlacione.** Ex.: `long_transactions`/`idle_in_transaction` explica locks presos e undo crescendo; `stale_stats` explica plano ruim que aparece em `top_queries`.
3. **Aja só com autorização explícita.** Para encerrar uma sessão problemática use `ora_kill_session(sid, serial, mode)`: `cancel` (cancela só o SQL, 19c+, reversível) antes de `kill` (derruba a sessão, ROLLBACK). Exige `READ_ONLY=false` na conexão e privilégio `ALTER SYSTEM` — se recusar, oriente o usuário a ajustar. Confirme `sid`+`serial` (de `active_queries`/`blocking_locks`) e o impacto antes.

## Como responder
1. Fundamente cada diagnóstico no JSON real das tools (cite sid, tablespace, lag, pct).
2. Aponte a causa provável e o risco; se faltar dado, indique o próximo `check` sem inventar.
3. Feche sempre passando pelo gate da skill `dba-wiring`.
