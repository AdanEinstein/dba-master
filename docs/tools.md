# Tools MCP

Todas as tools retornam **JSON estruturado** (em `content[].text`), pensado para consumo
por outro agente de IA — não para leitura humana direta.

| Tool | O que faz | Parâmetros |
|---|---|---|
| `list_tables` | Lista tabelas (owner, nome, num_rows) | `schema?` |
| `search_tables` | Busca tabelas por substring do nome (case-insensitive) | `pattern`, `schema?` |
| `describe_table` | Colunas (tipo, nullable, default), PK, FKs de saída, índices; gera a interface `.ts` em cache | `table`, `schema?` |
| `list_views` | Lista views (owner, nome) | `schema?`, `pattern?` |
| `describe_view` | Colunas (tipo, nullable) e o SELECT que define a view; gera a interface `.ts` em cache | `view`, `schema?` |
| `generate_interfaces` | Compila em lote: gera/atualiza a interface `.ts` de **todas** as tabelas (e views) do schema | `schema?`, `includeViews?` |
| `get_relationships` | Grafo de FKs: `outgoing` (FKs da tabela) e `incoming` (quem a referencia) | `table`, `schema?` |
| `get_ddl` | DDL de tabela/view/procedure/package/trigger/sequence/type | `name`, `schema?`, `objectType?` |
| `list_procedures` | Procedures/functions standalone com assinatura de parâmetros (nome, tipo, IN/OUT) | `schema?`, `pattern?` |
| `list_packages` | Packages e seus subprogramas, cada um com assinatura | `schema?`, `pattern?` |
| `list_schedulers_jobs` | Jobs agendados (ação, agendamento, estado, próxima execução) | `schema?`, `pattern?` |
| `run_sql` | Executa SQL; com `READ_ONLY` só permite `SELECT`/`WITH`, limita linhas | `sql`, `maxRows?` |

## Parâmetros comuns

- **`schema`** (opcional): escopa a um owner específico. Omitido = todos os schemas
  acessíveis (exclui os mantidos pela Oracle).
- **`pattern`** (opcional nas listagens): substring do nome, case-insensitive.

## Capability flag

Recursos que variam por banco (`list_packages`, `list_schedulers_jobs`) trazem um campo
`supported`. Se o banco atual não tem o recurso, a resposta é `{ "supported": false, ... }`
com lista vazia — sem erro. No Oracle, ambos são `true`.

## `run_sql` e o modo read-only

Com `READ_ONLY=true` (default), só `SELECT`/`WITH`/`EXPLAIN` passam; escrita
(INSERT/UPDATE/DELETE/MERGE/DDL) é rejeitada com erro. A verificação é pelo primeiro
token do statement — é uma guarda, não um parser SQL. Para bloqueio forte, use um usuário
Oracle read-only (`GRANT SELECT`). `maxRows` limita o retorno (default 200).

## Cache de tipos

Em cada `describe_table`/`describe_view`, o objeto vira `CACHE_DIR/<OWNER>/<NOME>.ts` com uma
`interface` TypeScript (default de `CACHE_DIR`: `.dba-master/types`). A regeneração é
**incremental**: compara o `LAST_DDL_TIME` gravado no header do arquivo com o do banco e só
reescreve se o objeto mudou. A resposta inclui `cacheFile` com o caminho gerado.

Para popular o diretório inteiro de uma vez, use `generate_interfaces` (tool) ou
`npx dba-master generate` (CLI) — ver [instalacao.md](instalacao.md). Detalhes do cache em
[arquitetura.md](arquitetura.md).
