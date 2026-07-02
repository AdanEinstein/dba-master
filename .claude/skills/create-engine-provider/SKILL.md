---
name: create-engine-provider
description: >-
  Adiciona suporte a um novo banco de dados (engine) ao dba-master — Postgres,
  MySQL, SQL Server, etc. Use sempre que o usuário quiser "suportar Postgres",
  "adicionar MySQL", "criar um provider para SQL Server", "novo engine de
  banco", "outro dialeto", ou implementar a porta DatabaseProvider para um banco
  ainda não suportado. Guia a implementação completa das 3 camadas (connection,
  queries, provider) espelhando o adapter Oracle e faz o wiring no
  ProviderManager. Não use para adicionar uma tool MCP nova (isso é
  create-mcp-tool) nem para conectar/investigar um banco já suportado.
---

# Adicionar um novo engine de banco

O dba-master usa arquitetura hexagonal. A porta é `src/domain/database-provider.ts`
(`DatabaseProvider`). Tudo — tools, cache, domínio — depende só dessa interface,
nunca de um driver ou dialeto concreto. Adicionar um banco = escrever **um adapter**
que implementa a porta, sem tocar em nada de domínio ou tools.

O adapter Oracle em `src/infrastructure/oracle/` é a implementação de referência.
**Leia os 3 arquivos dele antes de começar** — você vai espelhar a estrutura, só
trocando o driver e o SQL do dialeto:

- `oracle-connection.ts` — pool do driver + `query()` cru
- `oracle-queries.ts` — todo o SQL do dialeto, devolve linhas cruas tipadas
- `oracle-provider.ts` — implementa a porta, transforma linhas → DTOs de `domain/types.js`

## Por que 3 camadas

A separação existe pra manter o dialeto isolado: o provider fala em DTOs
neutros (`TableRef`, `ColumnInfo`…), a camada de queries concentra o SQL
específico do banco, e a connection isola o driver. Assim, quando uma query
do dialeto muda, você mexe num só arquivo, e o resto do sistema não percebe.
Mantenha essa disciplina no engine novo.

## Passos

Use `<engine>` como o identificador em minúsculas (ex.: `postgres`, `mysql`, `mssql`).

1. **Dependência do driver.** Adicione o driver ao `package.json` (`pg`, `mysql2`,
   `mssql`…) e instale. Prefira um driver com pool nativo, como o oracledb faz.

2. **`src/infrastructure/<engine>/<engine>-connection.ts`** — espelhe
   `OracleConnection`: pool lazy (criado no primeiro uso), método `query<T>()` que
   pega conexão do pool, executa e devolve `.close()`. Respeite `cfg.poolMax`
   (`?? DEFAULT_POOL_MAX`). Devolva linhas como objetos. `close()` fecha o pool.

3. **`src/infrastructure/<engine>/<engine>-queries.ts`** — espelhe `OracleQueries`.
   Recebe a connection + `schemaFilter: string[]` no construtor. Cada método roda
   um SELECT do catálogo do banco e devolve linhas cruas tipadas por `interface`.
   Na maioria dos bancos (Postgres, MySQL, SQL Server) o catálogo é o
   `information_schema` + tabelas de sistema (`pg_catalog`, `sys.*`). Replique a
   lógica de `ownerClause`/filtro de schema do Oracle para o conceito equivalente
   (schema no Postgres, database no MySQL).

4. **`src/infrastructure/<engine>/<engine>-provider.ts`** — `implements DatabaseProvider`.
   - `readonly engine = "<engine>"`.
   - `capabilities`: seja honesto. Postgres/MySQL/SQL Server **não têm** packages
     PL/SQL → `packages: false`. `scheduledJobs` só `true` se você realmente
     implementar (pg_cron, MySQL events, SQL Agent); senão `false`.
   - `typeToTs(dataType)`: mapeie os tipos do dialeto (ex.: Postgres `int4/int8` →
     `number`, `text/varchar` → `string`, `timestamptz` → `Date`, `bytea` →
     `Buffer`). Devolva `"unknown"` no fallback.
   - Implemente cada método da porta transformando as linhas cruas da camada de
     queries nos DTOs de `domain/types.js`. Espelhe os helpers de agrupamento do
     `oracle-provider.ts` (`groupOutgoing`, `groupIndexes`…) — a forma dos DTOs é
     a mesma para todos os bancos.

5. **Wiring no `src/infrastructure/provider-manager.ts`** — adicione o `case
   "<engine>":` no `switch` de `createProvider`, retornando `new <Engine>Provider(...)`.
   **Atualize a mensagem de erro** do `default` para listar o novo engine em
   "Suportados:". Sem isso o engine existe mas ninguém consegue instanciá-lo.

## Capabilities: recursos que a porta marca como opcionais

Métodos como `listPackages` e `listScheduledJobs` existem na porta mas as tools
consultam `capabilities` antes de expô-los. Se `capabilities.packages` for
`false`, ainda assim implemente `listPackages` retornando `[]` (não lance) — é o
contrato mínimo e evita quebrar quem chamar direto. `listDdlTimes` é opcional
(`?`) — implemente se o banco tiver um jeito barato de pegar todos os
`last_ddl_time` numa query (é o fast-path do cache); senão, omita.

## Verificação

Rode antes de dizer que terminou:

```bash
npm run build && npm test
```

O build (`tsc`) falha se você não implementou toda a interface `DatabaseProvider`
— use isso como checklist. Depois, teste de ponta a ponta contra um banco real:
adicione uma conexão `<engine>` no `connections.json` e rode `list_tables` /
`describe_table` pela tool. Um provider que compila mas devolve DTO errado só
aparece rodando de verdade.

## O que NÃO fazer

- Não toque em `domain/`, `mcp/tools/`, nem no cache — o ponto da arquitetura é
  que o engine novo não precisa disso. Se você sentir que precisa, provavelmente
  está vazando dialeto pra fora do adapter.
- Não invente método na porta pra um recurso só do seu banco — recurso específico
  vai em `engineSpecific` do DTO (veja `ScheduledJob.engineSpecific` no Oracle).
