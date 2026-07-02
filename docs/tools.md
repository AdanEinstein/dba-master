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
| `describe_table` | Colunas (tipo, nullable, default, comentário), PK, FKs de saída, índices, CHECK, comentário da tabela; gera a interface `.ts` em cache | `table`, `schema?` |
| `list_views` | Lista views (owner, nome) | `schema?`, `pattern?` |
| `describe_view` | Colunas (tipo, nullable, comentário) e o SELECT que define a view; gera a interface `.ts` em cache | `view`, `schema?` |
| `generate_interfaces` | Compila em lote: gera/atualiza a interface `.ts` de **todas** as tabelas (e views) do schema | `schema?`, `includeViews?`, `force?` |
| `get_relationships` | Grafo de FKs: `outgoing` (FKs da tabela) e `incoming` (quem a referencia) | `table`, `schema?` |
| `infer_relationships` | FKs **implícitas** (não declaradas) inferidas por convenção de nome, com `confidence` (high/medium) e `evidence` — para banco legado | `schema?` |
| `get_ddl` | DDL de objetos. Oracle: tabela/view/procedure/package/trigger/sequence/type (via `DBMS_METADATA`). Postgres: table (reconstruída), view/materialized view e function/procedure (nativo) | `name`, `schema?`, `objectType?` |
| `list_procedures` | Procedures/functions standalone com assinatura de parâmetros (nome, tipo, IN/OUT) | `schema?`, `pattern?` |
| `list_packages` | Packages e seus subprogramas, cada um com assinatura | `schema?`, `pattern?` |
| `list_schedulers_jobs` | Jobs agendados (ação, agendamento, estado, próxima execução) | `schema?`, `pattern?` |
| `run_sql` | Executa SQL; com `readOnly` (da conexão) só permite `SELECT`/`WITH`, limita linhas | `sql`, `maxRows?` |
| `pg_monitor` | **Só Postgres.** Monitoramento (leitura): sessões, locks, vacuum, bloat, índices, cache hit, WAL/checkpoints, replicação. Escolha a métrica em `check` (ver abaixo) | `check`, `limit?`, `orderBy?`, `idleMinutes?` |
| `pg_kill_session` | **Só Postgres, destrutivo.** Cancela (`cancel`) ou derruba (`terminate`) uma sessão pelo `pid`. Exige `READ_ONLY=false` na conexão | `pid`, `mode?` |

## Parâmetros comuns

- **`schema`** (opcional): escopa a um owner/schema específico. Omitido = todos os schemas
  acessíveis (Oracle: exclui os mantidos pela Oracle; Postgres: exclui `pg_*` e `information_schema`).
- **`pattern`** (opcional nas listagens): substring do nome, case-insensitive.

## Capability flag

Recursos que variam por banco (`list_packages`, `list_schedulers_jobs`) trazem um campo
`supported`. Se o banco atual não tem o recurso, a resposta é `{ "supported": false, ... }`
com lista vazia — sem erro. No Oracle, ambos são `true`. No PostgreSQL, ambos são `false`
(não há packages PL/SQL nem scheduler nativo).

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

## Cache de tipos

Em cada `describe_table`/`describe_view`, o objeto vira `<cache>/<NOME_DA_CONEXAO>/<OWNER>/<NOME>.ts` com uma
`interface` TypeScript (o cache é sempre `.dba-master/types`, ao lado do `connections.json`). O header marca
`// kind: table`/`// kind: view` e também guarda um `hash` de integridade. Em bloco JSDoc, ele traz o 
comentário do objeto, PK, `UNIQUE`, `CHECK`, relacionamentos e o comentário de cada coluna. A regeneração é
**incremental**: o builder valida o hash criptográfico do conteúdo novo e só reescreve no disco
se houver mudança. A resposta inclui `cacheFile` com o caminho gerado.

Passe `force: true` (ou `--force` no CLI) para ignorar o cache e reescrever tudo (já não é mais estritamente necessário para sincronizar FKs de entrada, pois o hash já captura essa alteração).

Para popular o diretório inteiro de uma vez, use `generate_interfaces` (tool) ou
`npx -y dba-master@latest generate` (CLI) — ver [instalacao.md](instalacao.md). Detalhes do cache em
[arquitetura.md](arquitetura.md).
