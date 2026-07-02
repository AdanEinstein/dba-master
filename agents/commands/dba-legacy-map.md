Faça engenharia reversa de um banco **legado** com as tools MCP do **dba-master**:
reconstrua o mapa que o banco não documenta — relacionamentos ausentes, lógica de
negócio escondida em PL/SQL e jobs — e entregue um panorama utilizável. Legado costuma
não ter FK declarada, ter nomes crípticos e regra de negócio dentro do banco. Descubra,
não chute.

## Alvo

$ARGUMENTS

## Como mapear (do estreito para o amplo)

As tools retornam **JSON estruturado**. Um banco legado pode ter milhares de objetos —
comece pelo recorte do alvo, não pelo schema inteiro.

0. **Selecione o banco.** Rode `list_connections`. Se houver mais de uma conexão, **DEVE
   perguntar ao usuário** qual mapear e passe `connectionName` nas demais tools.
1. **Delimite o território.** `search_tables` (padrão do nome) ou `list_tables` com o
   `schema`. Identifique as tabelas do domínio-alvo antes de aprofundar.
2. **Detalhe as tabelas centrais.** `describe_table` — colunas, PK, FKs declaradas,
   índices. Anote nomes crípticos e colunas que *parecem* chaves estrangeiras (`*_ID`,
   `*_COD`) mas não têm constraint.
3. **Reconstrua o grafo ausente.** `infer_relationships` no schema: detecta FKs implícitas
   por convenção de nome, com `confidence` (high/medium) e `evidence`. É o passo que dá
   o mapa que o banco legado não declara. Combine com `get_relationships` (FKs reais).
   Ao rodar `generate_interfaces`, essas inferências ficam gravadas no cache `.ts` (anotação
   `FK? →` na coluna e `FK implícita (inferida) →` no JSDoc) — o mapa vira base de conhecimento.
4. **Ache a lógica de negócio no banco.** `list_packages` / `list_procedures` trazem as
   assinaturas; `list_schedulers_jobs`, as rotinas agendadas. Em legado, muita regra vive
   aqui. Se a tool responder `{ "supported": false }`, o banco não tem o recurso.
5. **Puxe DDL do que importa.** `get_ddl` de triggers (regra escondida em `BEFORE/AFTER`),
   packages e sequences que sustentam as PKs.
6. **Confirme com dados reais.** `run_sql` (read-only): valide FKs implícitas `medium`
   contando órfãos (`LEFT JOIN alvo ... WHERE pk IS NULL`), cheque cardinalidade e nulos.

## Como responder
1. Entregue um mapa com tabelas, relações (declaradas/inferidas), lógica PL/SQL e riscos; e trate FK implícita `high` como provável e `medium` como hipótese (nunca apresentando inferência como constraint).
2. Se faltar informação, diga qual tool rodar em seguida sem inventar estrutura.
3. Feche sempre a sua resposta passando pelo gate da skill `dba-wiring`.
