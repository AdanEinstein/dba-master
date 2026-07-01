# dba-master

Servidor MCP (Model Context Protocol) que dá a um agente de IA introspecção profunda de um
banco **Oracle** — estrutura, DDL, relacionamentos, procedures, jobs — em **JSON estruturado**,
para investigar o schema e propor soluções (queries, modelagem, diagnósticos) com assertividade.

Modo **thin** (default) é JS puro e não exige Oracle Instant Client.

## Instalação

Não precisa clonar o repositório. Tudo roda como subcomando da bin via `npx`.

**1. Registrar o server MCP** nos agentes (Claude, Copilot, Opencode, Antigravity). As
credenciais vão no ambiente e são gravadas no bloco `env` do config de cada agente:

```bash
ORACLE_USER=usuario ORACLE_PASSWORD=senha ORACLE_CONNECT_STRING=host:1521/service_name \
  npx -y dba-master install-mcp                 # todos os agentes
  npx -y dba-master install-mcp --agent claude  # só um
```

No Claude Code, alternativamente via CLI:

```bash
claude mcp add dba-master \
  -e ORACLE_USER=usuario -e ORACLE_PASSWORD=senha \
  -e ORACLE_CONNECT_STRING=host:1521/service_name \
  -- npx -y dba-master
```

**2. Instalar o comando `dba-investigate`** (workflow que orienta o agente a usar as tools):

```bash
npx -y dba-master install-agents                # todos os agentes
```

Reabra/recarregue o agente após instalar.

### Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `ORACLE_USER` / `ORACLE_PASSWORD` | sim | Credenciais |
| `ORACLE_CONNECT_STRING` | sim | Ex.: `host:1521/service_name` |
| `SCHEMA_FILTER` | não | Schemas separados por vírgula; vazio = todos os acessíveis |
| `READ_ONLY` | não | `true` (default) bloqueia escrita no `run_sql` |
| `ORACLE_CLIENT_MODE` | não | `thin` (default) ou `thick` |

## Uso

Depois de instalado, o agente ganha as tools MCP e o comando `/dba-investigate`. Descreva a
demanda (ex.: "otimize esta query", "modele X") e o agente investiga o schema com as tools:

| Tool | O que faz |
|---|---|
| `list_tables` / `search_tables` | Lista/busca tabelas |
| `describe_table` | Colunas, PK, FKs, índices |
| `get_relationships` | Grafo de FKs (entrada e saída) |
| `get_ddl` | DDL de tabela/view/procedure/package/trigger/sequence/type |
| `list_procedures` / `list_packages` | PL/SQL com assinatura de parâmetros |
| `list_schedulers_jobs` | Jobs agendados |
| `run_sql` | SQL (read-only por padrão) |

As respostas são JSON estruturado, pensadas para consumo pelo agente.

## Documentação

Guias completos no repositório:

- `docs/instalacao.md` — setup a partir do repo, todas as variáveis, verificação.
- `docs/tools.md` — referência das 9 tools, parâmetros, capability flag, cache.
- `docs/agentes.md` — instalação nos agentes de IA (destinos por agente).
- `docs/arquitetura.md` — ports & adapters, como adicionar um banco novo, `READ_ONLY`.
- `docs/release.md` — publicação no npm e como cortar um release (CI/CD).
