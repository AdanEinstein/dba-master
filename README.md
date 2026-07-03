# dba-master

Servidor MCP (Model Context Protocol) que dá a um agente de IA introspecção profunda de banco de dados — estrutura, DDL, relacionamentos, procedures, jobs — em **JSON estruturado**,
para investigar o schema e propor soluções (queries, modelagem, diagnósticos) com assertividade.

<img width="1535" height="1024" alt="image" src="https://github.com/user-attachments/assets/9d2f337d-865d-4802-a930-b12ad9aa9e2c" />

Modo **thin** (default para Oracle) é JS puro e não exige Instant Client. Só defina `"thick": true` na conexão se precisar de recursos específicos do client nativo.

## 🔒 A IA não tem acesso às credenciais do banco

**Nenhuma tool MCP retorna dados sensíveis de conexão.** `list_connections` devolve só os *nomes* das conexões — nunca `user`, `password` ou `connectString`. As credenciais são usadas apenas internamente para abrir o pool; o agente jamais as recebe no output das tools.

Para fechar o último vetor — o agente conseguir **ler o `connections.json` em texto plano** —, qualquer campo aceita a referência `${NOME_DA_VAR}`, resolvida a partir das variáveis de ambiente no boot do server. Assim o segredo fica **fora do arquivo que o agente lê**, num env var que só o processo do servidor herda:

```json
{
    "prod": {
        "engine": "oracle",
        "user": "${DBA_PROD_USER}",
        "password": "${DBA_PROD_PASS}",
        "connectString": "${DBA_PROD_CS}"
    }
}
```

O `configure`/`install` grava essas referências por padrão e pode **persistir as env vars no seu ambiente** (com sua permissão): `export` no `~/.zshrc`/`~/.bashrc` (Linux/macOS) ou `setx` no registro do usuário (Windows). Editar uma conexão atualiza as vars; excluí-la — ou rodar `uninstall` — remove-as.

> É defesa **best-effort** contra leitura casual/acidental do agente. Um processo rodando com o mesmo usuário/shell ainda consegue ler o ambiente; para fronteira de segurança dura, use um keychain do SO ou isole o server em outro usuário/container.

## Bancos suportados

O engine é escolhido pelo campo `engine` da conexão. Recursos exclusivos de um banco (packages PL/SQL e jobs agendados, por ex.) são expostos só onde existem — ver [Capability flag](#capability-flag).

- [x] **Oracle** (`oracle`) — thin/thick, packages, jobs agendados, DDL via `DBMS_METADATA`
- [x] **PostgreSQL** (`postgres`) — conexão via URL, DDL nativo (`pg_get_viewdef`/`pg_get_functiondef`) + `CREATE TABLE` reconstruído
- [x] **MySQL / MariaDB** (`mysql`) — conexão via URL, tabelas, views, dicionário via `information_schema`
- [ ] **SQL Server** — planejado

## Instalação e Configuração

Não precisa clonar o repositório. Tudo roda como subcomando da bin via `npx`.

**1. Iniciar o setup unificado**

```bash
npx -y dba-master@latest install
```

O comando abrirá uma interface interativa onde você poderá:
- Criar, editar, excluir ou usar conexões com bancos de dados.
- Selecionar se deseja instalação com **escopo de projeto** (na pasta atual) ou **global** (na home).
- Selecionar quais agentes de IA deseja configurar (Claude, Copilot, Opencode, Antigravity).

As credenciais e conexões configuradas serão salvas no arquivo `connections.json` (dentro da pasta `.dba-master` do seu projeto ou globalmente em `~/.dba-master/`).

Para desinstalar e limpar os agentes configurados, basta executar:

```bash
npx -y dba-master@latest uninstall
```

Para gerenciar as conexões existentes de forma isolada (criar, editar ou excluir credenciais sem instalar os agentes novamente), use:

```bash
npx -y dba-master@latest configure
```

No Claude Code, alternativamente via CLI (apenas registro do server MCP — as credenciais vêm do `connections.json`, criado com `npx -y dba-master@latest configure`):

```bash
claude mcp add dba-master -s user -- npx -y dba-master@latest
```

Outros clientes MCP (manual, via stdio) — sem bloco `env`, pois as credenciais vivem no `connections.json`:

```jsonc
{
  "command": "npx",
  "args": ["-y", "dba-master@latest"]
}
```

Reabra/recarregue o agente após instalar. O agente vai ganhar as ferramentas MCP e o comando `/dba-investigate` (workflow que orienta o agente a usar as tools).

**2. Gerar as interfaces do schema (opcional)**

```bash
npx -y dba-master@latest generate            # compila todas as tabelas + views em .ts
```

Popula o cache (`.dba-master/types`) de uma vez com as interfaces TypeScript de todo o schema — ver
[Gerar interfaces do schema](#gerar-interfaces-do-schema) para flags e detalhes.

### Setup a partir do repositório (dev)

```bash
npm install
cp connections.example.json ./.dba-master/connections.json   # edite com suas credenciais
npm run build                                                 # compila para dist/
```

### Configuração Manual

O `dba-master` lê as conexões **exclusivamente** de um arquivo `connections.json` localizado na pasta `.dba-master` (`./.dba-master/connections.json` no projeto — que tem precedência — ou `~/.dba-master/connections.json` global). O arquivo é um mapa plano `nomeDaConexao → objeto de conexão` (ver `connections.example.json`). Qualquer campo string aceita a referência `${VAR}`, resolvida a partir das variáveis de ambiente no boot (ver [🔒 A IA não tem acesso às credenciais do banco](#-a-ia-não-tem-acesso-às-credenciais-do-banco)) — **recomendado para não deixar segredo em texto plano**. Exemplo:

```json
{
  "prod": {
    "engine": "oracle",
    "user": "${DBA_PROD_USER}",
    "password": "${DBA_PROD_PASS}",
    "connectString": "${DBA_PROD_CS}",
    "thick": false,
    "poolMax": 8,
    "readOnly": true,
    "schemaFilter": ["APP"]
  },
  "pg": {
    "engine": "postgres",
    "connectString": "${DBA_PG_CS}",
    "readOnly": true,
    "schemaFilter": ["public"]
  }
}
```

Os valores também podem ser gravados em texto plano direto no JSON (menos seguro). Se uma `${VAR}` referenciada não existir no ambiente, o server falha no boot nomeando a var. No Postgres, `user`/`password` vêm embutidos na URL da `connectString` (como no exemplo `pg` acima).

Normalmente o arquivo é gravado pelos prompts interativos de `npx -y dba-master@latest configure` (ou `install`). Para ajustar `readOnly`/`schemaFilter`/`poolMax`, edite o JSON manualmente. Campos por conexão:

| Campo | Obrigatório | Descrição |
|---|---|---|
| `user` / `password` | sim* | Credenciais. *No Postgres podem vir embutidos na `connectString` (URL) |
| `connectString` | sim | Oracle: `host:1521/service_name`. Postgres: URL `postgresql://user:senha@host:5432/db` |
| `engine` | não | Engine de banco: `oracle` (default) ou `postgres` |
| `thick` | não | **Só Oracle.** `false` (default) usa modo thin; `true` exige Instant Client |
| `clientLibDir` | não | **Só Oracle.** Libs do client (só thick, caminho não-padrão) |
| `poolMax` | não | Tamanho máximo do pool (default `8`) |
| `readOnly` | não | `true` (default) bloqueia escrita no `run_sql`; leitura sempre liberada |
| `schemaFilter` | não | Array de schemas; vazio (`[]`, default) = todos os schemas de usuário. Oracle: nomes em MAIÚSCULO (exclui os mantidos pela Oracle); Postgres: nomes como `public` (exclui `pg_*` e `information_schema`) |
| `tunnel` | não | Túnel/proxy quando o banco só é acessível via bastion. Ver abaixo |

O `cacheDir` não é configurável: é sempre `<pasta do connections.json>/types` (ex.: `.dba-master/types`).

### Túnel / proxy (bancos em rede privada)

Bancos acessíveis só via **bastion** aceitam um bloco `tunnel` por conexão. O
`connectString` continua apontando para o **host:porta real** do banco — a camada
de túnel abre o transporte, aloca uma porta local efêmera e reescreve a conexão
por baixo (o driver disca no túnel, transparente). É **lazy**: o túnel só sobe
quando a conexão é de fato usada, e conexões sem `tunnel` discam direto. Os
segredos do túnel (chave/senha SSH, URL de proxy com credencial) usam a mesma
indireção `${VAR}` — nada de segredo em texto plano no `connections.json`.

Configurável pelos prompts de `npx -y dba-master@latest configure` (create/edit) ou à mão. Três tipos:

**SSH (bastion)** — via lib `ssh2` (puro JS, cross-platform). Host key validado por
`~/.ssh/known_hosts` por padrão (ou pin `hostKey` com fingerprint SHA256). Auth:
chave por caminho **ou** conteúdo PEM (`privateKey`), `passphrase`, `password`, ou
`agent: true` (usa `SSH_AUTH_SOCK`).

```json
"via_bastion": {
  "engine": "postgres",
  "connectString": "${DBA_PROD_CS}",
  "tunnel": {
    "type": "ssh", "host": "bastion.example.com", "port": 22,
    "user": "${SSH_USER}", "privateKey": "${SSH_KEY_PATH}"
  }
}
```

**Proxy SOCKS5 / HTTP CONNECT** — `type: "socks"` ou `"http"`, com `url` (aceita credenciais embutidas):

```json
"tunnel": { "type": "socks", "url": "${PROXY_URL}" }   // socks5://user:senha@host:1080
```

**Comando externo** — delega o forward a um binário que escuta numa porta local (`cloud-sql-proxy`, `aws ssm`, `sshuttle`...). O dba-master só faz spawn, espera a porta abrir e mata no fim:

```json
"tunnel": {
  "type": "command", "command": "cloud-sql-proxy",
  "args": ["--port", "5432", "my-project:region:instance"],
  "listenHost": "127.0.0.1", "listenPort": 5432
}
```

> Oracle via túnel suporta EZConnect (`host:port/service`); TNS descriptor completo está fora de escopo.

### Gerar interfaces do schema

Além da geração sob demanda no `describe_table`/`describe_view`, dá para **compilar tudo de
uma vez** — todas as tabelas (e views) viram `interface` `.ts` no cache (`.dba-master/types`).
Mesmo estilo do `install`, roda via `npx`:

```bash
npx -y dba-master@latest generate                 # todas as tabelas + views
npx -y dba-master@latest generate --schema HR     # só o schema HR
npx -y dba-master@latest generate --no-views      # pula views
npx -y dba-master@latest generate --connection prod   # conexão nomeada
npx -y dba-master@latest generate --force         # ignora o cache e reescreve tudo
```

Incremental (valida por hash do conteúdo para pular reescrita). Também disponível como tool MCP
`generate_interfaces` para o agente chamar sob demanda.

Cada `.ts` gerado é uma **base de conhecimento**: marca `// kind: table` ou `// kind: view`
e, em bloco JSDoc, traz o comentário do objeto, PK, índices `UNIQUE`, `CHECK`, os
relacionamentos (`FK →` de saída e `referenciada por ←` de entrada) e o comentário de cada
coluna. Use `--force` na primeira execução após atualizar o dba-master para reescrever os
arquivos antigos (o cache pula objetos inalterados via validação de hash).

### Verificação

Com um banco Oracle ou PostgreSQL acessível, valide as tools via [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector npx -y dba-master@latest
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
| `describe_table` | Colunas (tipo, nullable, default, comentário), PK, FKs de saída, índices, CHECK, comentário da tabela; gera interface `.ts` | `table`, `schema?` |
| `list_views` | Lista views (owner, nome) | `schema?`, `pattern?` |
| `describe_view` | Colunas (com comentário) e o SELECT da view; gera interface `.ts` | `view`, `schema?` |
| `generate_interfaces` | Compila em lote a interface `.ts` de todas as tabelas (e views) do schema | `schema?`, `includeViews?`, `force?` |
| `get_relationships` | Grafo de FKs: `outgoing` (FKs da tabela) e `incoming` (quem a referencia) | `table`, `schema?` |
| `infer_relationships` | FKs **implícitas** inferidas por convenção de nome (banco legado), com confiança e evidência | `schema?` |
| `get_ddl` | DDL de objetos. Oracle: tabela/view/procedure/package/trigger/sequence/type (via `DBMS_METADATA`). Postgres: table (reconstruída de colunas/constraints), view/materialized view e function/procedure (nativo) | `name`, `schema?`, `objectType?` |
| `list_procedures` | Procedures/functions com assinatura de parâmetros | `schema?`, `pattern?` |
| `list_packages` | Packages e seus subprogramas com assinaturas | `schema?`, `pattern?` |
| `list_schedulers_jobs` | Jobs agendados (ação, agendamento, estado, próxima exec) | `schema?`, `pattern?` |
| `run_sql` | Executa SQL (sujeito ao `readOnly` da conexão) | `sql`, `maxRows?` |
| `pg_monitor` | **Só Postgres, leitura.** Monitoramento: sessões, locks, vacuum, bloat, índices, cache hit, WAL/checkpoints, replicação — via `check` | `check`, `limit?`, `orderBy?`, `idleMinutes?` |
| `pg_kill_session` | **Só Postgres, destrutivo.** Cancela/derruba uma sessão pelo `pid`; exige `READ_ONLY=false` | `pid`, `mode?` |
| `ora_monitor` | **Só Oracle, leitura.** Monitoramento: sessões, locks, top SQL, tablespace, cache, índices, redo, Data Guard — via `check` | `check`, `limit?`, `orderBy?`, `idleMinutes?` |
| `ora_kill_session` | **Só Oracle, destrutivo.** Cancela o SQL (`cancel`, 19c+) ou derruba (`kill`) uma sessão por `sid`+`serial`; exige `READ_ONLY=false` + `ALTER SYSTEM` | `sid`, `serial`, `mode?` |
| `mysql_monitor` | **Só MySQL, leitura.** Monitoramento: sessões, locks, transações longas, top queries (performance_schema), engine status — via `check` | `check` |
| `mysql_kill_session` | **Só MySQL, destrutivo.** Cancela a query ou derruba a conexão por `connectionId`; exige `READ_ONLY=false` | `connectionId`, `mode?` |

**Parâmetros comuns:**
- **`connectionName`** (opcional): O nome da conexão mapeada para usar (ex: `prod`, `default`). Necessário quando há mais de uma conexão listada por `list_connections`.
- **`schema`** (opcional): escopa a um owner específico. Omitido = todos os schemas acessíveis (exclui os mantidos pela Oracle).
- **`pattern`** (opcional nas listagens): substring do nome, case-insensitive.

### Capability flag

Recursos que variam por banco (`list_packages`, `list_schedulers_jobs`) trazem um campo `supported`. Se o banco atual não tem o recurso, a resposta é `{ "supported": false, ... }` com lista vazia — sem erro. No Oracle, ambos são `true`. No PostgreSQL, ambos são `false` (não há packages PL/SQL nem scheduler nativo). No MySQL, `list_packages` é `false` mas `list_schedulers_jobs` é `true` (mapeado para MySQL Events).

### `run_sql` e o modo read-only

Com `readOnly: true` na conexão (default), só `SELECT`/`WITH`/`EXPLAIN` passam; escrita (INSERT/UPDATE/DELETE/MERGE/DDL) é rejeitada com erro. A verificação é pelo primeiro token do statement — é uma guarda, não um parser SQL. Para bloqueio forte, use um usuário Oracle read-only (`GRANT SELECT`). `maxRows` limita o retorno (default 200).

### Monitoramento Postgres (`pg_monitor` / `pg_kill_session`)

Exclusivas do engine Postgres. `pg_monitor` é somente leitura — cada `check` é um `SELECT`
fixo sobre `pg_stat_*`/`pg_catalog` (fica sempre dentro do read-only). Escolha a métrica em
`check`: atividade (`active_queries`, `long_transactions`), sessões (`connections_usage`,
`idle_in_transaction`), locks (`blocking_locks`, `deadlocks`), `top_queries` (exige extensão
`pg_stat_statements`; `orderBy` total/mean/max), vacuum (`dead_tuples`, `wraparound`), storage
(`table_sizes`, `cache_hit`), índices (`unused_indexes`, `seq_scans`), WAL (`wal_stats`,
`checkpoints`) e replicação (`replication`, `replication_slots`). Colunas divergentes entre
PG16- e PG17+ (`top_queries`, `checkpoints`) são resolvidas por detecção automática de versão.
Lista completa dos `check` em [docs/tools.md](docs/tools.md).

`pg_kill_session(pid, mode)` é a única ação destrutiva: `cancel` (reversível) ou `terminate`
(ROLLBACK). Bloqueada quando a conexão está `readOnly` (default) — mesma guarda de `run_sql`.
Para diagnósticos guiados, use o comando `/dba-pg-monitor`.

### Monitoramento Oracle (`ora_monitor` / `ora_kill_session`)

Exclusivas do engine Oracle. `ora_monitor` é somente leitura — cada `check` é um `SELECT`
fixo sobre views `v$`/`dba_*` (exige `SELECT_CATALOG_ROLE`). Sem detecção de versão (views
estáveis 12c–23c); colunas voltam em UPPERCASE; consulta só a instância local (`v$`).
Escolha a métrica em `check`: atividade (`active_queries`, `long_transactions`), sessões
(`connections_usage`, `idle_in_transaction`), locks (`blocking_locks`, `deadlocks`),
`top_queries` (`orderBy` total/mean/io), storage (`tablespace_usage`, `table_sizes`,
`stale_stats`), cache (`cache_hit`, `library_cache`), índices (`unused_indexes` 12.2+,
`full_scans`), redo (`redo_stats`, `log_switches`) e Data Guard (`dataguard_stats`,
`archive_dest`). Lista completa em [docs/tools.md](docs/tools.md).

`ora_kill_session(sid, serial, mode)` é a única ação destrutiva: `cancel` (só o SQL, 19c+,
reversível) ou `kill` (derruba a sessão, ROLLBACK). Exige `ALTER SYSTEM` e é bloqueada quando
a conexão está `readOnly` (default). Para diagnósticos guiados, use o comando `/dba-ora-monitor`.

### Monitoramento MySQL / MariaDB (`mysql_monitor` / `mysql_kill_session`)

Exclusivas do engine MySQL. `mysql_monitor` é somente leitura — cada `check` é um `SELECT`
fixo sobre as tabelas de sistema do `information_schema` e `performance_schema`.
Escolha a métrica em `check`: atividade (`active_queries`, `all_activity`, `long_transactions`), locks (`blocking_locks`),
`top_queries` (exige extensão `performance_schema` ativada), storage (`table_sizes`), e `engine_status`.

`mysql_kill_session(connectionId, mode)` é a única ação destrutiva: `query` (só o SQL,
reversível) ou `connection` (derruba a sessão, ROLLBACK). Bloqueada quando
a conexão está `readOnly` (default). Para diagnósticos guiados, use o comando `/dba-mysql-monitor`.


### Cache de tipos

Em cada `describe_table`/`describe_view`, o objeto vira `<cache>/<NOME_DA_CONEXAO>/<OWNER>/<NOME>.ts` com uma `interface` TypeScript (o cache é sempre `.dba-master/types`, ao lado do `connections.json`). O arquivo marca `// kind: table`/`// kind: view` e, em bloco JSDoc, traz comentário do objeto, PK, `UNIQUE`, `CHECK`, relacionamentos (`FK →` de saída, `referenciada por ←` de entrada) e comentário de cada coluna. Ao compilar em lote (`generate_interfaces` / `generate`), o cache também reflete as **FKs implícitas** inferidas por `infer_relationships` — anotadas na coluna (`FK? → alvo (implícita, confiança)`) e no bloco JSDoc (`FK implícita (inferida) → alvo [confiança: evidência]`). A regeneração é **incremental**: o builder valida o hash (SHA-256) do conteúdo gerado contra o header do arquivo e só o reescreve se o hash mudar (o que soluciona corretamente o problema de invalidação para alterações nas dependências da tabela). A resposta inclui `cacheFile` com o caminho gerado. Para popular o diretório inteiro de uma vez, use `generate_interfaces` (tool) ou `npx -y dba-master@latest generate` (CLI).

**Otimização para LSP:** Um `tsconfig.json` também é gerado automaticamente na raiz da conexão (`.dba-master/types/<NOME_DA_CONEXAO>/tsconfig.json`). Isso agrupa os arquivos exportados em um projeto único, ativando suporte avançado de autocomplete, Go-to-Definition e resolução de módulos nativamente por editores baseados em LSP (`tsserver`) e agentes de IA integrados.
