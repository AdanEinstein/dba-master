# Arquitetura

## Ports & adapters (hexagonal)

O domínio e as tools dependem de uma **interface** (`DatabaseProvider`), nunca de um driver
ou dialeto SQL concreto. O acoplamento a um banco específico vive só no seu adapter.

```
mcp/tools  →  domain/database-provider (PORT)  ←  infrastructure/oracle (ADAPTER)
```

```
src/
  config.ts                         # configuração (.env) + DB_ENGINE
  domain/
    types.ts                        # DTOs + lógica pura (isWriteStatement, generateInterface)
    database-provider.ts            # PORT: interface DatabaseProvider + Capabilities
  infrastructure/
    oracle/
      oracle-connection.ts          # pool node-oracledb + query()
      oracle-queries.ts             # SQL ALL_*/DBMS_METADATA
      oracle-provider.ts            # implements DatabaseProvider: query + transforma linha→DTO + typeToTs
    schema-cache.ts                 # geração das interfaces .ts (DB-agnóstico)
    provider-factory.ts             # switch(engine) → provider
  schema-compiler.ts                # generateInterfaces: lote sobre describe* + writeTableCache
  cli-generate.ts                   # subcomando `npx dba-master generate`
  mcp/
    shared.ts                       # jsonResult/errorResult + args zod
    register.ts                     # registra todas as tools, injetando o provider
    tools/*.tool.ts                 # uma tool por arquivo, cada uma register(server, provider)
  index.ts                          # composition root: config → provider → tools
```

Fluxo de dependência unidirecional: `mcp` → port ← `infrastructure`, com `domain`
compartilhado. Tools e domínio **nunca** importam `oracledb`, `ALL_*` nem `DBMS_METADATA` —
tudo isso está isolado em `infrastructure/oracle/`.

## Adicionar um banco novo

1. Criar `src/infrastructure/<engine>/<engine>-provider.ts` que
   `implements DatabaseProvider`. Recursos que o banco não tem (ex.: packages no Postgres)
   → declarar `capabilities.packages = false`; a tool responde `{ supported: false }` sem erro.
2. Adicionar um `case "<engine>"` em `src/infrastructure/provider-factory.ts`.
3. Selecionar via `DB_ENGINE=<engine>` no `.env`.

Nada muda em `domain/`, `mcp/tools/*` nem `index.ts`.

## Cache incremental de tipos

`describe_table`/`describe_view` geram `CACHE_DIR/<OWNER>/<NOME>.ts` com uma `interface`
(default de `CACHE_DIR`: `.dba-master/types`, ao lado do `connections.json`). O mapeamento de
tipos vem do provider (`typeToTs` — específico do banco), então o cache é DB-agnóstico.
O header do arquivo grava o `LAST_DDL_TIME`; na próxima chamada, se bater, a geração é
pulada. Isso dá ao agente tanto um cache navegável quanto tipos utilizáveis em código.

Para compilar o schema inteiro de uma vez, `schema-compiler.ts` (`generateInterfaces`) compõe
`describe*` + `writeTableCache` num laço sobre `listTables`/`listViews`. Exposto de dois modos,
ambos incrementais: a tool MCP `generate_interfaces` e o subcomando CLI `npx dba-master generate`
(`cli-generate.ts`, standalone: `loadConfig` → `ProviderManager` → `generateInterfaces`).

## Semântica do `READ_ONLY`

Bloqueia **apenas** escrita (INSERT/UPDATE/DELETE/MERGE/DDL) no `run_sql`. Toda leitura —
SELECT, extração de DDL, leitura de procedures/packages/schedulers/metadados — é sempre
permitida, por ser introspecção, não mutação. A guarda (`isWriteStatement`, em `domain/`) é
DB-agnóstica e composta na tool `run_sql`, fora do adapter.

## Por que do zero (e não fork)

Nenhuma ferramenta existente cobre 80%+ do escopo em Node/TS:

| Ferramenta | Stack | Cobre | Falta |
|---|---|---|---|
| [oracle-mcp-server](https://github.com/danielmeppiel/oracle-mcp-server) | Python | cache de schema, busca, constraints, source PL/SQL | Python (reescrita total), sem `run_sql`, sem schedulers, sem grafo de FK dedicado |
| Oracle SQLcl MCP Server (SQLcl 25.2+) | Java | `run-sql`/`run-sqlcl`, DDL, oficial | superfície genérica, sem tools semânticas, sem cache/JSON pré-formatado, processo externo |
| [oracle/skills](https://github.com/oracle/skills) (ex krisrice) | Markdown | receitas de SQL (monitoramento, segurança, PL/SQL) | não é código nem MCP — é referência |

Decisão: **construir do zero** em Node/TS com `oracledb`, inspirado no design de cache do
oracle-mcp-server, usando `DBMS_METADATA.GET_DDL` (nativo) em vez de subprocess SQLcl.

> Geração de tipos TS: **não** usamos `kanel` (só suporta PostgreSQL). A introspecção é
> própria, via `oracledb` lendo `ALL_TAB_COLUMNS`/`ALL_CONSTRAINTS`/`ALL_CONS_COLUMNS`.
