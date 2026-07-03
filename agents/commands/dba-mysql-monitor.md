Monitore e diagnostique um banco **MySQL / MariaDB** em produção usando as tools MCP do
**dba-master** (`mysql_monitor` e, quando autorizado, `mysql_kill_session`). Não chute
métricas — colete-as pelas tools antes de concluir.

## Demanda

$ARGUMENTS

## Como monitorar

As tools retornam **JSON estruturado**.
`mysql_monitor` é somente leitura; escolha a métrica pelo parâmetro `check`. As consultas dependem
do `information_schema` e `performance_schema` (se habilitado).

0. **Selecione o banco.** Rode `list_connections`. Se houver mais de uma conexão, **pergunte ao usuário** qual monitorar e passe o nome em `connectionName`. `mysql_monitor`/`mysql_kill_session` só funcionam em conexões MySQL/MariaDB.
1. **Comece pelo sintoma.** Escolha o `check` conforme a queixa:
   - App travado / lento agora → `active_queries`, depois `blocking_locks` (quem bloqueia quem).
   - "Sessões/processos esgotados" → `all_activity`.
   - Escrita/DDL travada → `blocking_locks`.
   - Transação aberta há muito tempo → `long_transactions` (trava o purge do InnoDB).
   - Query lenta recorrente → `top_queries` (exige `performance_schema` habilitado).
   - Storage enchendo → `table_sizes`.
   - Status geral do Engine → `engine_status` (SHOW ENGINE INNODB STATUS).
2. **Correlacione.** Ex.: `long_transactions` explica locks presos; `top_queries` evidencia gargalos frequentes.
3. **Aja só com autorização explícita.** Para encerrar uma sessão problemática use `mysql_kill_session(connectionId, mode)`: `query` (cancela só a instrução) ou `connection` (derruba a sessão inteira, ROLLBACK). Exige `READ_ONLY=false` na conexão — se recusar, oriente o usuário a ajustar no setup. Confirme `connectionId` (obtido de `active_queries` ou `blocking_locks`) e o impacto antes.

## Como responder
1. Fundamente cada diagnóstico no JSON real das tools (cite connectionId, table, query time).
2. Aponte a causa provável e o risco; se faltar dado, indique o próximo `check` sem inventar.
3. Feche sempre passando pelo gate da skill `dba-wiring`.
