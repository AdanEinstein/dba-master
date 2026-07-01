---
description: Investiga o schema de um banco via tools MCP do dba-master e propõe soluções (queries, modelagem, diagnóstico)
---

Investigue o banco de dados com as tools MCP do **dba-master** para atender a uma
demanda (query, ajuste de modelagem, diagnóstico de performance) com o máximo de
assertividade. Não chute a estrutura — descubra-a pelas tools antes de propor.

## Demanda

$ARGUMENTS

## Como investigar (do estreito para o amplo)

As tools retornam **JSON estruturado**. Um banco pode ter milhares de tabelas —
comece estreito para não afogar o contexto.

0. **Selecione o banco de dados.** Comece rodando a tool `list_connections`. Se houver mais de uma conexão listada, você **DEVE perguntar ao usuário** qual conexão ele deseja investigar. Passe esse nome no argumento `connectionName` para as demais tools.
1. **Localize as entidades.** Use `search_tables` (padrão do nome) ou, se já souber o
   schema, `list_tables` com o `schema`. Não liste tudo se um `search` resolve.
2. **Detalhe as tabelas relevantes.** `describe_table` traz colunas (tipo, nullable,
   default), PK, FKs de saída e índices — e gera/atualiza a interface `.ts` em cache.
3. **Entenda os relacionamentos.** `get_relationships` dá o grafo de FKs: `outgoing`
   (FKs que a tabela possui) e `incoming` (quem a referencia). Essencial para joins
   corretos e para prever o raio de impacto de uma mudança.
4. **Puxe o DDL quando precisar do detalhe fino.** `get_ddl` (tabela, view, procedure,
   package, trigger, sequence, type) mostra constraints, identity, storage etc.
5. **Investigue lógica de negócio no banco.** `list_procedures` / `list_packages`
   trazem assinaturas de parâmetros; `list_schedulers_jobs`, os jobs agendados. Se a
   tool responder `{ "supported": false }`, o banco atual não tem aquele recurso.
6. **Diagnostique com dados reais.** `run_sql` (somente leitura por padrão) para
   `SELECT`/`WITH` — contagens, distribuição, `EXPLAIN PLAN`, checagem de nulos.
   Escrita (INSERT/UPDATE/DDL) só se `READ_ONLY=false`.

## Como responder

- Fundamente cada afirmação no que as tools retornaram (cite tabela/coluna/FK).
- Entregue SQL pronto para uso, com os nomes de schema/coluna reais que você descobriu.
- Aponte riscos: FKs de entrada afetadas, índices ausentes para o filtro proposto,
  colunas anuláveis que exigem tratamento.
- Se faltar informação, diga qual tool rodar em seguida — não invente estrutura.
