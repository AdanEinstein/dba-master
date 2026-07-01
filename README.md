# dba-master

Servidor MCP (Model Context Protocol) em Node.js/TypeScript que dá a um agente de IA
introspecção profunda de um banco **Oracle** — estrutura, DDL, relacionamentos —
para que ele investigue o schema e proponha soluções com assertividade.

As respostas são **JSON estruturado**, pensadas para consumo por outro agente, não
para leitura humana. A introspecção usa as views `ALL_*`, cobrindo **todos os schemas
acessíveis** ao usuário conectado (não só um), e persiste um **cache incremental** de
interfaces TypeScript por tabela.

## Por que do zero (e não fork)

Nenhuma ferramenta existente cobre 80%+ do escopo em Node/TS:

| Ferramenta | Stack | Cobre | Falta |
|---|---|---|---|
| [oracle-mcp-server](https://github.com/danielmeppiel/oracle-mcp-server) | Python | cache de schema, busca, constraints, source PL/SQL | Python (reescrita total), sem `run_sql`, sem schedulers, sem grafo de FK dedicado |
| Oracle SQLcl MCP Server (SQLcl 25.2+) | Java | `run-sql`/`run-sqlcl`, DDL, oficial | superfície genérica, sem tools semânticas, sem cache/JSON pré-formatado, processo externo |
| [oracle/skills](https://github.com/oracle/skills) (ex krisrice) | Markdown | receitas de SQL (monitoramento, segurança, PL/SQL) | não é código nem MCP — é referência |

Decisão: **construir do zero** em Node/TS com `oracledb`, inspirado no design de cache
do oracle-mcp-server, usando `DBMS_METADATA.GET_DDL` (nativo) em vez de subprocess SQLcl,
e as receitas do oracle/skills como referência para as próximas tools.

> Geração de tipos TS: **não** usamos `kanel` (só suporta PostgreSQL). A introspecção é
> própria, via `oracledb` lendo `ALL_TAB_COLUMNS`/`ALL_CONSTRAINTS`/`ALL_CONS_COLUMNS`.

## Tools desta iteração

| Tool | O que faz |
|---|---|
| `list_tables` | Lista tabelas (owner, nome, num_rows) de um schema ou de todos |
| `search_tables` | Busca tabelas por substring do nome (case-insensitive) |
| `describe_table` | Colunas (tipo, nullable, default), PK, FKs de saída, índices; gera a interface `.ts` em cache |
| `get_relationships` | Grafo de FKs: `outgoing` (FKs da tabela) e `incoming` (quem a referencia) |
| `get_ddl` | DDL de tabela/view/procedure/package/trigger/sequence/type via `DBMS_METADATA` |
| `list_procedures` | Procedures/functions standalone com assinatura de parâmetros (nome, tipo, IN/OUT) |
| `list_packages` | Packages e seus subprogramas, cada um com assinatura de parâmetros |
| `list_schedulers_jobs` | Jobs do `DBMS_SCHEDULER` (ação, agendamento, estado, próxima execução) |
| `run_sql` | Executa SQL; com `READ_ONLY` só permite `SELECT`/`WITH`, limita linhas retornadas |

Todas as tools de listagem aceitam `schema` (owner) e `pattern` (substring do nome) opcionais.

## Setup

```bash
npm install
cp .env.example .env   # edite com suas credenciais
npm run build          # compila para dist/
```

Modo **thin** (default) é JS puro e não exige Oracle Instant Client. Só use
`ORACLE_CLIENT_MODE=thick` se precisar de recursos específicos do client nativo.

### Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `ORACLE_USER` / `ORACLE_PASSWORD` | sim | Credenciais |
| `ORACLE_CONNECT_STRING` | sim | Ex.: `host:1521/service_name` |
| `ORACLE_CLIENT_MODE` | não | `thin` (default) ou `thick` |
| `ORACLE_CLIENT_LIB_DIR` | não | Libs do client (só thick, caminho não-padrão) |
| `SCHEMA_FILTER` | não | Lista de schemas separada por vírgula; vazio = todos os acessíveis |
| `READ_ONLY` | não | `true` (default) bloqueia escrita no `run_sql` (tool futura); leitura sempre liberada |
| `CACHE_DIR` | não | Diretório das interfaces `.ts` (default: `./.cache`) |

Sobre `READ_ONLY`: bloqueia **apenas** escrita (INSERT/UPDATE/DELETE/MERGE/DDL) no `run_sql`.
Toda leitura — SELECT, extração de DDL, metadados — é sempre permitida, por ser introspecção.

## Cache de tipos

Em cada `describe_table`, a tabela vira `CACHE_DIR/<OWNER>/<TABELA>.ts` com uma
`interface` TypeScript. A regeneração é **incremental**: compara o `LAST_DDL_TIME`
gravado no header do arquivo com o do banco e só reescreve se a tabela mudou.

## Registro no cliente MCP

### Claude Code (CLI)

```bash
claude mcp add dba-master -- node /caminho/para/dba-master/dist/index.js
```

Ou aponte para o modo dev sem build:

```bash
claude mcp add dba-master -- npx tsx /caminho/para/dba-master/src/index.ts
```

### Claude Desktop

Em `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "dba-master": {
      "command": "node",
      "args": ["/caminho/para/dba-master/dist/index.js"],
      "env": {
        "ORACLE_USER": "meu_usuario",
        "ORACLE_PASSWORD": "minha_senha",
        "ORACLE_CONNECT_STRING": "host:1521/service_name"
      }
    }
  }
}
```

As variáveis podem vir do `.env` (carregado automaticamente) ou do bloco `env`.

## Verificação

```bash
npm run typecheck   # tsc --noEmit
npm test            # self-check do mapeamento de tipos (sem banco)
```

Com um banco Oracle acessível, valide as tools via
[MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```
