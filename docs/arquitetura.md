# Arquitetura

## Ports & adapters (hexagonal)

O domínio e as tools dependem de uma **interface** (`DatabaseProvider`), nunca de um driver
ou dialeto SQL concreto. O acoplamento a um banco específico vive só no seu adapter.

```
mcp/tools  →  domain/database-provider (PORT)  ←  infrastructure/{oracle,postgres} (ADAPTERS)
```

```
src/
  config.ts                         # carrega o connections.json (mapa de conexões + engine)
  domain/
    types.ts                        # DTOs + lógica pura (isWriteStatement, generateInterface)
    database-provider.ts            # PORT: interface DatabaseProvider + Capabilities
  infrastructure/
    oracle/
      oracle-connection.ts          # pool node-oracledb + query()
      oracle-queries.ts             # SQL ALL_*/DBMS_METADATA
      oracle-provider.ts            # implements DatabaseProvider: query + transforma linha→DTO + typeToTs
    postgres/
      pg-connection.ts              # pool node-postgres + query() (binds $1)
      pg-queries.ts                 # SQL information_schema/pg_catalog
      pg-provider.ts                # implements DatabaseProvider: query + transforma linha→DTO + typeToTs
    schema-cache.ts                 # geração das interfaces .ts (DB-agnóstico)
    provider-manager.ts             # createProvider: switch(engine) → provider + gerencia conexões
  mcp/
    shared.ts                       # jsonResult/errorResult + args zod
    register.ts                     # registra todas as tools, injetando o provider
    tools/*.tool.ts                 # uma tool por arquivo, cada uma register(server, provider)
  index.ts                          # composition root: config → provider → tools
setup/                              # subcomando `npx -y dba-master@latest install` e `uninstall` (UI @clack + cfonts)
generator/                          # subcomando `npx -y dba-master@latest generate`
  schema-compiler.ts                # generateInterfaces: lote sobre describe* + writeTableCache
  index.ts                          # CLI: UI @clack + cfonts, spinner com progresso
```

Fluxo de dependência unidirecional: `mcp` → port ← `infrastructure`, com `domain`
compartilhado. Tools e domínio **nunca** importam `oracledb`, `ALL_*` nem `DBMS_METADATA` —
tudo isso está isolado nos adapters de `infrastructure/` (`oracle/`, `postgres/`).

## Adicionar um banco novo

1. Criar `src/infrastructure/<engine>/<engine>-provider.ts` que
   `implements DatabaseProvider`. Recursos que o banco não tem (ex.: packages no Postgres)
   → declarar `capabilities.packages = false`; a tool responde `{ supported: false }` sem erro.
2. Adicionar um `case "<engine>"` no `createProvider` de `src/infrastructure/provider-manager.ts`.
3. Selecionar via `"engine": "<engine>"` na conexão do `connections.json`.

Nada muda em `domain/`, `mcp/tools/*` nem `index.ts`.

## Cache incremental de tipos

`describe_table`/`describe_view` geram `<cache>/<NOME_DA_CONEXAO>/<OWNER>/<NOME>.ts` com uma `interface`
(o cache é sempre `.dba-master/types`, ao lado do `connections.json`). O mapeamento de
tipos vem do provider (`typeToTs` — específico do banco), então o cache é DB-agnóstico.

O header do arquivo grava o `hash` criptográfico (SHA-256) do conteúdo; na próxima chamada, o hash do novo conteúdo gerado é comparado e se bater, a reescrita no sistema de arquivos é pulada. Isso dá ao agente tanto um cache navegável quanto tipos utilizáveis em código.

Para compilar o schema inteiro de uma vez, `schema-compiler.ts` (`generateInterfaces`) compõe
`describe*` + `writeTableCache` num laço sobre `listTables`/`listViews`. Exposto de dois modos,
ambos incrementais: a tool MCP `generate_interfaces` e o subcomando CLI `npx -y dba-master@latest generate`
(pasta `generator/`, com UI animada @clack/cfonts; standalone: `loadConfig` → `ProviderManager`
→ `generateInterfaces`, que emite progresso via `onProgress` para o spinner).

## Semântica do `readOnly`

Configurado por conexão no `connections.json` (default `true`), bloqueia **apenas** escrita
(INSERT/UPDATE/DELETE/MERGE/DDL) no `run_sql`. Toda leitura —
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
