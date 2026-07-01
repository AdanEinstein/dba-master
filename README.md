# dba-master

Servidor MCP (Model Context Protocol) que dá a um agente de IA introspecção profunda de banco de dados — estrutura, DDL, relacionamentos, procedures, jobs — em **JSON estruturado**,
para investigar o schema e propor soluções (queries, modelagem, diagnósticos) com assertividade.

Modo **thin** (default para Oracle) é JS puro e não exige Instant Client. Só use `DB_CLIENT_MODE=thick` se precisar de recursos específicos do client nativo.

## Instalação e Configuração

Não precisa clonar o repositório. Tudo roda como subcomando da bin via `npx`.

**1. Iniciar o instalador unificado**

```bash
npx -y dba-master@latest install
```

O comando abrirá uma interface interativa onde você poderá:
- Configurar uma ou mais conexões com bancos de dados.
- Selecionar se deseja instalação com **escopo de projeto** (na pasta atual) ou **global** (na home).
- Selecionar quais agentes de IA deseja configurar (Claude, Copilot, Opencode, Antigravity).

As credenciais e conexões configuradas serão salvas no arquivo `connections.json` (dentro da pasta `.dba-master` do seu projeto ou globalmente em `~/.dba-master/`).

No Claude Code, alternativamente via CLI (apenas configuração do server MCP, exigirá variáveis de ambiente de fallback):

```bash
claude mcp add dba-master -s user \
  -e DB_USER=usuario -e DB_PASSWORD=senha \
  -e DB_CONNECT_STRING=host:1521/service_name \
  -- npx -y dba-master
```

Outros clientes MCP (manual, via stdio):

```jsonc
{
  "command": "npx",
  "args": ["-y", "dba-master"],
  "env": {
    "DB_USER": "usuario",
    "DB_PASSWORD": "senha",
    "DB_CONNECT_STRING": "host:1521/service_name"
  }
}
```

Reabra/recarregue o agente após instalar. O agente vai ganhar as ferramentas MCP e o comando `/dba-investigate` (workflow que orienta o agente a usar as tools).

### Setup a partir do repositório (dev)

```bash
npm install
cp .env.example .env   # edite com suas credenciais
npm run build          # compila para dist/
```

### Configuração Manual

O `dba-master` trabalha nativamente lendo as conexões a partir de um arquivo `connections.json` localizado na pasta `.dba-master` (global ou no projeto atual). Exemplo:

```json
{
  "prod": {
    "engine": "oracle",
    "user": "system",
    "password": "syspassword",
    "connectString": "localhost:1521/ORCL"
  }
}
```

Caso o arquivo não seja encontrado, o sistema possui um fallback para ler a conexão "default" a partir das **Variáveis de ambiente**:

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DB_USER` / `DB_PASSWORD` | sim | Credenciais |
| `DB_CONNECT_STRING` | sim | Ex.: `host:1521/service_name` |
| `DB_ENGINE` | não | Engine de banco (default `oracle`) |
| `DB_CLIENT_MODE` | não | `thin` (default) ou `thick` |
| `DB_CLIENT_LIB_DIR` | não | Libs do client (só thick, caminho não-padrão) |
| `SCHEMA_FILTER` | não | Lista de schemas separada por vírgula; vazio = todos os acessíveis |
| `READ_ONLY` | não | `true` (default) bloqueia escrita no `run_sql`; leitura sempre liberada |
| `CACHE_DIR` | não | Diretório das interfaces `.ts` (default: `.dba-master/.cache`) |

### Verificação

Com um banco Oracle acessível, valide as tools via [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector npx -y dba-master
```
*(Se estiver no repositório local, use `npx @modelcontextprotocol/inspector node dist/index.js`)*

## Uso e Tools MCP

Depois de instalado, o agente ganha as tools MCP e o comando `/dba-investigate`. Descreva a
demanda (ex.: "otimize esta query", "modele X") e o agente investiga o schema.

Todas as tools retornam **JSON estruturado** (em `content[].text`), pensado para consumo por outro agente de IA — não para leitura humana direta.

O `dba-master` suporta **múltiplas conexões**. Utilize a tool `list_connections` para descobrir os bancos mapeados.

| Tool | O que faz | Parâmetros |
|---|---|---|
| `list_connections` | Lista as conexões mapeadas configuradas no dba-master | - |
| `list_tables` | Lista tabelas (owner, nome, num_rows) | `connectionName`, `schema?` |
| `search_tables` | Busca tabelas por substring do nome (case-insensitive) | `pattern`, `schema?` |
| `describe_table` | Colunas (tipo, nullable, default), PK, FKs de saída, índices; gera interface `.ts` | `table`, `schema?` |
| `get_relationships` | Grafo de FKs: `outgoing` (FKs da tabela) e `incoming` (quem a referencia) | `table`, `schema?` |
| `get_ddl` | DDL de tabela/view/procedure/package/trigger/sequence/type | `name`, `schema?`, `objectType?` |
| `list_procedures` | Procedures/functions com assinatura de parâmetros | `schema?`, `pattern?` |
| `list_packages` | Packages e seus subprogramas com assinaturas | `schema?`, `pattern?` |
| `list_schedulers_jobs` | Jobs agendados (ação, agendamento, estado, próxima exec) | `schema?`, `pattern?` |
| `run_sql` | Executa SQL (sujeito ao `READ_ONLY`) | `sql`, `maxRows?` |

**Parâmetros comuns:**
- **`connectionName`** (opcional): O nome da conexão mapeada para usar (ex: `prod`, `default`). Necessário quando há mais de uma conexão listada por `list_connections`.
- **`schema`** (opcional): escopa a um owner específico. Omitido = todos os schemas acessíveis (exclui os mantidos pela Oracle).
- **`pattern`** (opcional nas listagens): substring do nome, case-insensitive.

### Capability flag

Recursos que variam por banco (`list_packages`, `list_schedulers_jobs`) trazem um campo `supported`. Se o banco atual não tem o recurso, a resposta é `{ "supported": false, ... }` com lista vazia — sem erro. No Oracle, ambos são `true`.

### `run_sql` e o modo read-only

Com `READ_ONLY=true` (default), só `SELECT`/`WITH`/`EXPLAIN` passam; escrita (INSERT/UPDATE/DELETE/MERGE/DDL) é rejeitada com erro. A verificação é pelo primeiro token do statement — é uma guarda, não um parser SQL. Para bloqueio forte, use um usuário Oracle read-only (`GRANT SELECT`). `maxRows` limita o retorno (default 200).

### Cache de tipos

Em cada `describe_table`, a tabela vira `CACHE_DIR/<OWNER>/<TABELA>.ts` com uma `interface` TypeScript. A regeneração é **incremental**: compara o `LAST_DDL_TIME` gravado no header do arquivo com o do banco e só reescreve se a tabela mudou. A resposta inclui `cacheFile` com o caminho gerado.
