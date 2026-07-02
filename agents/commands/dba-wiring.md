Verifique se uma entrega sobre banco (query, modelagem, diagnóstico) está **ancorada**
na estrutura real — descoberta pelas tools MCP do **dba-master** — antes de apresentá-la.
O princípio é o mesmo do "wiring" de código: nada serve se não estiver *ligado* ao real.
Aqui, ligado = cada tabela, coluna e relação citada existe e foi confirmada por tool.

## O que verificar

$ARGUMENTS

## O gate de wiring (4 passos)

Rode antes de entregar. Se algum passo falhar, volte para as tools — não entregue chute.

1. **Toda entidade existe.** Cada tabela/coluna que a resposta usa foi confirmada em
   `describe_table` (ou `describe_view`)? Nome exato, schema correto, tipo conferido.
2. **Toda relação está provada.** Cada join/FK usado é uma FK declarada
   (`get_relationships`) OU uma FK implícita com evidência (`infer_relationships`,
   `confidence` e `evidence` citados)? Sem relação inventada por intuição.
3. **A query roda no real.** `run_sql` (read-only) executou a query, ou ao menos um
   `EXPLAIN PLAN` / contagem de amostra, contra o banco — não só "parece certo".
4. **Zero schema inventado.** Nenhuma coluna, tabela ou constraint aparece na resposta
   sem ter saído de uma tool. Se faltou algo, o gap é nomeado, não preenchido com palpite.

## DO / DON'T

- DO: citar a origem de cada afirmação (`describe_table` de X, `infer_relationships` deu
  `high` para Y→Z). DON'T: afirmar "provavelmente há uma FK entre A e B".
- DO: marcar FK implícita `medium` como *hipótese a validar* e sugerir a query de checagem
  (contar órfãos: `LEFT JOIN ... WHERE pk IS NULL`). DON'T: tratá-la como certa.
- DO: rodar a query proposta em read-only e reportar o resultado. DON'T: entregar SQL que
  você nunca executou como se estivesse validado.

## Checklist de wiring

- [ ] Cada tabela/coluna citada saiu de `describe_table`/`describe_view`
- [ ] Cada join usa FK declarada (`get_relationships`) ou implícita com evidência (`infer_relationships`)
- [ ] FKs implícitas `medium` marcadas como hipótese + query de validação sugerida
- [ ] A query final rodou em `run_sql` (read-only) e o resultado foi conferido
- [ ] Nenhum nome de objeto na resposta sem origem em tool
- [ ] Gaps de informação nomeados (qual tool rodar em seguida), não inventados

## Como responder

- Se tudo passou: entregue o SQL/modelo com os nomes reais e uma linha de proveniência
  por afirmação não-óbvia.
- Se algo falhou: diga qual passo falhou e qual tool rodar para fechar o gap. Não entregue
  o que não passou no gate.
