# dba-master

Servidor MCP (Model Context Protocol) em Node.js/TypeScript que dá a um agente de IA
introspecção profunda de um banco **Oracle** — estrutura, DDL, relacionamentos, procedures,
jobs — para que ele investigue o schema e proponha soluções (queries, ajustes de modelagem,
diagnósticos) com assertividade.

As respostas são **JSON estruturado**, pensadas para consumo por outro agente. A introspecção
usa as views `ALL_*`, cobrindo **todos os schemas acessíveis** ao usuário conectado, e persiste
um **cache incremental** de interfaces TypeScript por tabela. A arquitetura é **ports & adapters**:
Oracle é um adapter; adicionar outro banco é criar um novo adapter, sem tocar em domínio/tools.

## Quick start

```bash
npm install
cp .env.example .env   # edite com suas credenciais Oracle
npm run build
claude mcp add dba-master -- node "$(pwd)/dist/index.js"
```

Modo **thin** (default) não exige Oracle Instant Client. Detalhes: [docs/instalacao.md](docs/instalacao.md).

## Tools

| Tool | O que faz |
|---|---|
| `list_tables` / `search_tables` | Lista/busca tabelas |
| `describe_table` | Colunas, PK, FKs, índices; gera interface `.ts` em cache |
| `get_relationships` | Grafo de FKs (entrada e saída) |
| `get_ddl` | DDL de tabela/view/procedure/package/trigger/sequence/type |
| `list_procedures` / `list_packages` | PL/SQL com assinatura de parâmetros |
| `list_schedulers_jobs` | Jobs agendados |
| `run_sql` | SQL (read-only por padrão) |

Referência completa: [docs/tools.md](docs/tools.md).

## Documentação

- [docs/instalacao.md](docs/instalacao.md) — setup, `.env`, variáveis de ambiente, verificação.
- [docs/tools.md](docs/tools.md) — referência das 9 tools, parâmetros, capability flag, cache.
- [docs/arquitetura.md](docs/arquitetura.md) — ports & adapters, camadas, como adicionar um banco novo, `READ_ONLY`.
- [docs/agentes.md](docs/agentes.md) — instalação nos agentes de IA (`agents/`).

## Verificação

```bash
npm run typecheck   # tsc --noEmit
npm test            # self-check sem banco
```
