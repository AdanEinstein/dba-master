# Tools MCP

Todas as tools retornam **JSON estruturado** (em `content[].text`), pensado para consumo
por outro agente de IA — não para leitura humana direta.

> **Segurança:** nenhuma tool retorna credenciais. `list_connections` devolve só os *nomes*
> das conexões — nunca `user`, `password` ou `connectString`. Segredos ficam fora do output
> das tools e, com `${VAR}`, fora do próprio `connections.json`.

| Tool | O que faz | Parâmetros |
|---|---|---|
| `list_connections` | Lista os **nomes** das conexões mapeadas (sem credenciais) | - |
| `list_tables` | Lista tabelas (owner, nome, num_rows) | `schema?` |
| `search_tables` | Busca tabelas por substring do nome (case-insensitive) | `pattern`, `schema?` |
| `describe_table` | Colunas (tipo, nullable, default, comentário), PK, FKs de saída, índices, CHECK, comentário da tabela; gera/reaproveita a interface `.ts` em cache. Se o cache está fresco, retorna enxuto (`cached:true`, `cacheFile`, `columnCount`) — **leia o `.ts`** | `table`, `schema?`, `force?` |
| `list_views` | Lista views (owner, nome) | `schema?`, `pattern?` |
| `describe_view` | Colunas (tipo, nullable, comentário) e o SELECT que define a view; gera/reaproveita a interface `.ts` em cache. Cache fresco → retorno enxuto (`cached:true`, `cacheFile`) | `view`, `schema?`, `force?` |
| `generate_interfaces` | Compila em lote: gera/atualiza a interface `.ts` de **todas** as tabelas (e views) do schema | `schema?`, `includeViews?`, `force?` |
| `get_relationships` | Grafo de FKs: `outgoing` (FKs da tabela) e `incoming` (quem a referencia) | `table`, `schema?` |
| `infer_relationships` | FKs **implícitas** (não declaradas) inferidas por convenção de nome, com `confidence` (high/medium) e `evidence` — para banco legado | `schema?` |
| `get_ddl` | DDL de objetos. Oracle: via `DBMS_METADATA`. Postgres: table (reconstruída), view e function. MySQL: table e view (nativo) | `name`, `schema?`, `objectType?` |
| `list_procedures` | Procedures/functions standalone com assinatura de parâmetros (nome, tipo, IN/OUT) | `schema?`, `pattern?` |
| `list_packages` | Packages e seus subprogramas, cada um com assinatura | `schema?`, `pattern?` |
| `list_schedulers_jobs` | Jobs agendados (ação, agendamento, estado, próxima execução) | `schema?`, `pattern?` |
| `run_sql` | Executa SQL; com `readOnly` (da conexão) só permite `SELECT`/`WITH`, limita linhas | `sql`, `maxRows?` |
| `pg_monitor` | **Só Postgres.** Monitoramento (leitura): sessões, locks, vacuum, bloat, índices, cache hit, WAL/checkpoints, replicação. Escolha a métrica em `check` (ver abaixo) | `check`, `limit?`, `orderBy?`, `idleMinutes?` |
| `pg_kill_session` | **Só Postgres, destrutivo.** Cancela (`cancel`) ou derruba (`terminate`) uma sessão pelo `pid`. Exige `READ_ONLY=false` na conexão | `pid`, `mode?` |
| `ora_monitor` | **Só Oracle.** Monitoramento (leitura): sessões, locks, top SQL, tablespace/segments, cache, índices, redo, Data Guard. Escolha a métrica em `check` (ver abaixo). Exige `SELECT_CATALOG_ROLE` | `check`, `limit?`, `orderBy?`, `idleMinutes?` |
| `ora_kill_session` | **Só Oracle, destrutivo.** Cancela o SQL (`cancel`, 19c+) ou derruba (`kill`) uma sessão por `sid`+`serial`. Exige `READ_ONLY=false` e `ALTER SYSTEM` | `sid`, `serial`, `mode?` |
| `mysql_monitor` | **Só MySQL.** Monitoramento (leitura): sessões, locks, transações longas, top queries, engine status. Escolha a métrica em `check` (ver abaixo) | `check` |
| `mysql_kill_session` | **Só MySQL, destrutivo.** Cancela (`query`) ou derruba (`connection`) uma sessão pelo `connectionId`. Exige `READ_ONLY=false` na conexão | `connectionId`, `mode?` |

## Parâmetros comuns

- **`schema`** (opcional): escopa a um owner/schema específico. Omitido = todos os schemas
  acessíveis (Oracle: exclui os mantidos pela Oracle; Postgres: exclui `pg_*` e `information_schema`).
- **`pattern`** (opcional nas listagens): substring do nome, case-insensitive.

## Capability flag

Recursos que variam por banco (`list_packages`, `list_schedulers_jobs`) trazem um campo
`supported`. Se o banco atual não tem o recurso, a resposta é `{ "supported": false, ... }`
com lista vazia — sem erro. No Oracle, ambos são `true`. No PostgreSQL, ambos são `false`
(não há packages PL/SQL nem scheduler nativo). No MySQL, `list_packages` é `false` mas
`list_schedulers_jobs` é `true` (mapeado para MySQL Events).

## `run_sql` e o modo read-only

Com `readOnly: true` na conexão (default), só `SELECT`/`WITH`/`EXPLAIN` passam; escrita
(INSERT/UPDATE/DELETE/MERGE/DDL) é rejeitada com erro. A verificação é pelo primeiro
token do statement — é uma guarda, não um parser SQL. Para bloqueio forte, use um usuário
de banco read-only (`GRANT SELECT`). `maxRows` limita o retorno (default 200).

## Monitoramento Postgres (`pg_monitor` / `pg_kill_session`)

Exclusivas do engine Postgres (retornam erro claro em Oracle). `pg_monitor` é somente
leitura — cada `check` é um `SELECT` fixo sobre `pg_stat_*`/`pg_catalog`, então fica
sempre dentro do modo read-only, independente da flag da conexão.

Valores de `check`, por área:

- **Atividade:** `active_queries` (executando agora), `all_activity` (tudo != idle), `long_transactions` (transações abertas mais antigas — travam vacuum e retêm WAL).
- **Sessões:** `sessions_by_state`, `connections_by_source` (leak por usuário/app/IP), `connections_usage` (uso vs `max_connections`), `idle_in_transaction` (aceita `idleMinutes`, default 5).
- **Locks:** `blocking_locks` (árvore via `pg_blocking_pids`), `locks_detail` (por tipo/relação/modo), `deadlocks`.
- **Queries:** `top_queries` — exige a extensão `pg_stat_statements`. `orderBy` = `total` (I/O+CPU agregado, default), `mean` (média por chamada) ou `max` (pior pico); `limit` (default 5). Ramifica automaticamente as colunas por versão (PG16- × PG17+).
- **Vacuum:** `vacuum_progress`, `dead_tuples`, `wraparound` (**crítico**: XIDs restantes até read-only forçado), `autovacuum_config`.
- **Storage:** `table_sizes` (tamanho + estimativa heurística de bloat via dead/live tuples), `database_sizes`, `cache_hit` (ideal > 99% em OLTP).
- **Índices:** `unused_indexes` (candidatos a DROP — validar em período representativo; nunca dropar PK/UNIQUE), `seq_scans` (candidatos a indexar), `index_cache_hit`.
- **WAL/checkpoint:** `wal_stats`, `checkpoints` (ramifica `pg_stat_bgwriter` × `pg_stat_checkpointer` por versão).
- **Replicação:** `replication` (lag de standby físico), `replication_slots` (slot `active=false` retém WAL — monitorar sempre), `publications`, `subscriptions`.

`pg_kill_session` é a única ação destrutiva: cancela (`mode: "cancel"`, `pg_cancel_backend`,
reversível) ou derruba (`mode: "terminate"`, `pg_terminate_backend`, faz ROLLBACK) o backend
do `pid`. Bloqueada quando a conexão está `readOnly` (default) — mesma guarda de `run_sql`.

## Monitoramento Oracle (`ora_monitor` / `ora_kill_session`)

Exclusivas do engine Oracle (retornam erro claro em Postgres). `ora_monitor` é somente
leitura — cada `check` é um `SELECT` fixo sobre views `v$`/`dba_*`. Exige
`SELECT_CATALOG_ROLE` (ou grants nas views); sem ele o Oracle devolve `ORA-00942` e o
erro chega ao agente. Sem detecção de versão (as views são estáveis de 12c a 23c) e as
colunas voltam em **UPPERCASE** (padrão Oracle). Consulta só a instância local (`v$`),
não o cluster RAC (`gv$`).

Valores de `check`, por área:

- **Atividade:** `active_queries` (status ACTIVE agora), `all_activity` (todas as sessões `type=USER`), `long_transactions` (transações abertas mais antigas — seguram undo).
- **Sessões:** `sessions_by_state`, `connections_by_source` (leak por program/machine/osuser), `connections_usage` (`v$resource_limit`: sessions/processes vs limite), `idle_in_transaction` (INACTIVE com transação aberta; aceita `idleMinutes`, default 5).
- **Locks:** `blocking_locks` (blocked × blocking via `blocking_session`), `locks_detail` (`v$lock` por tipo/modo/objeto), `deadlocks` (contador cumulativo `enqueue deadlocks`).
- **Queries:** `top_queries` (`v$sqlarea`). `orderBy` = `total` (elapsed agregado, default), `mean` (média por execução) ou `io` (buffer gets); `limit` (default 5).
- **Storage:** `tablespace_usage` (used_pct), `segment_sizes` (maiores segmentos), `table_sizes` (tabelas + `num_rows`), `stale_stats` (estatísticas velhas — candidatas a `DBMS_STATS`).
- **Cache:** `cache_hit` (buffer cache hit ratio), `library_cache` (`v$librarycache` get/pin hit).
- **Índices:** `unused_indexes` (`dba_index_usage` sem acesso — exige 12.2+; nunca dropar PK/UNIQUE), `full_scans` (contadores de full table scan).
- **Redo:** `redo_stats` (`redo size`/`writes`/`entries`), `log_switches` (frequência de switch por hora, análogo a checkpoint).
- **Data Guard:** `dataguard_stats` (apply/transport lag), `archive_dest` (destinos de archive em erro).

`ora_kill_session` é a única ação destrutiva: cancela só o SQL em curso (`mode: "cancel"`,
`ALTER SYSTEM CANCEL SQL`, exige 19c+, reversível) ou derruba a sessão (`mode: "kill"`,
`ALTER SYSTEM KILL SESSION ... IMMEDIATE`, faz ROLLBACK) por `sid`+`serial`. Exige `ALTER SYSTEM` e é bloqueada quando
a conexão está `readOnly` (default) — mesma guarda de `run_sql`.

## Monitoramento MySQL / MariaDB (`mysql_monitor` / `mysql_kill_session`)

Exclusivas do engine MySQL. `mysql_monitor` é somente
leitura — cada `check` é um `SELECT` fixo sobre as tabelas de sistema (`information_schema`, `performance_schema`)
ou comandos de diagnóstico nativos (`SHOW`).

Valores de `check`, por área:

- **Atividade:** `active_queries` (queries em execução exceto comando Sleep), `all_activity` (todo o processlist), `long_transactions` (transações abertas no InnoDB — retêm undo).
- **Locks:** `blocking_locks` (blocked × blocking do InnoDB via `innodb_lock_waits`).
- **Queries:** `top_queries` (via `performance_schema.events_statements_summary_by_digest` — exige que a performance_schema esteja habilitada).
- **Storage:** `table_sizes` (tamanho aproximado das tabelas com base em index_length + data_length).
- **Engine:** `engine_status` (saída crua de `SHOW ENGINE INNODB STATUS`).

`mysql_kill_session` é a única ação destrutiva: cancela (`mode: "query"`, reversível) ou derruba (`mode: "connection"`, faz ROLLBACK)
a sessão informada por `connectionId`. Bloqueada quando a conexão está `readOnly` (default) — mesma guarda de `run_sql`.

## Cache de tipos

Em cada `describe_table`/`describe_view`, o objeto vira `<cache>/<NOME_DA_CONEXAO>/<OWNER>/<NOME>.ts` com uma
`interface` TypeScript (o cache é sempre `.dba-master/types`, ao lado do `connections.json`). O header marca
`// kind: table`/`// kind: view`, um `hash` de integridade e um **token de frescor** (`// fresh: …`). Em bloco JSDoc, ele traz o 
comentário do objeto, PK, `UNIQUE`, `CHECK`, relacionamentos e o comentário de cada coluna. A regeneração é
**incremental**: o builder valida o hash criptográfico do conteúdo novo e só reescreve no disco
se houver mudança.

**Consumo (fast-path):** antes do describe completo, `describe_table`/`describe_view` fazem **uma** query barata para obter o token de frescor do objeto (Oracle: `last_ddl_time`; MySQL: `COALESCE(UPDATE_TIME, CREATE_TIME)`; Postgres: `md5` de uma assinatura do catálogo). Se bate com o `// fresh:` do `.ts` (**HIT**), a tool pula o describe e retorna enxuto — `{ "cached": true, "cacheFile", "owner", "tableName"/"viewName", "columnCount" }`; **leia o `.ts`** para o schema. Em **MISS** (token diferente, arquivo ausente, cache legado sem `// fresh:`, ou engine sem sinal), roda o describe completo, reescreve o cache e devolve o `TableSchema` inline com `"cached": false` e `cacheFile`. As respostas agora são **JSON compacto**.

Passe `force: true` (ou `--force` no CLI) para ignorar o cache e refazer o describe completo.

Para popular o diretório inteiro de uma vez, use `generate_interfaces` (tool) ou
`npx -y dba-master@latest generate` (CLI) — ver [instalacao.md](instalacao.md). Detalhes do cache em
[arquitetura.md](arquitetura.md).
