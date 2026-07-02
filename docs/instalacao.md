# Instalação e configuração

Duas formas: **via npm** (sem clonar) ou **a partir do repo** (dev). Em ambos os casos a
configuração vem **exclusivamente** do `connections.json` — não há leitura de `.env` nem de
variáveis de ambiente.

## Via npm (`npx`)

Não precisa clonar nem buildar. As credenciais ficam no `connections.json`, gravado pelos
prompts interativos de `configure` (ou `install`). O registro do server MCP no cliente não
tem bloco `env`:

```bash
npx -y dba-master@latest configure          # cria/edita o connections.json (prompts interativos)
claude mcp add dba-master -- npx -y dba-master@latest
```

## Setup a partir do repo (dev)

```bash
npm install
cp connections.example.json ./.dba-master/connections.json   # edite com suas credenciais
npm run build                                                 # compila para dist/
```

Modo **thin** (default para Oracle) é JS puro e não exige Instant Client. Só defina
`"thick": true` na conexão se precisar de recursos específicos do client nativo.

**Bancos suportados:** Oracle e PostgreSQL, escolhidos pelo campo `engine` (`oracle` | `postgres`).

## Campos do `connections.json`

O arquivo fica em `./.dba-master/connections.json` (projeto, tem precedência) ou
`~/.dba-master/connections.json` (global). É um mapa plano `nomeDaConexao → objeto de
conexão` (ver `connections.example.json` na raiz):

```json
{
  "my_conn": {
    "engine": "oracle",
    "user": "meu_usuario",
    "password": "minha_senha",
    "connectString": "host:1521/service_name",
    "thick": false,
    "poolMax": 8,
    "readOnly": true,
    "schemaFilter": ["APP"]
  },
  "my_pg": {
    "engine": "postgres",
    "connectString": "postgresql://user:senha@localhost:5432/meu_banco",
    "readOnly": true,
    "schemaFilter": ["public"]
  }
}
```

| Campo | Obrigatório | Descrição |
|---|---|---|
| `user` / `password` | sim* | Credenciais. *No Postgres podem vir embutidos na `connectString` (URL) |
| `connectString` | sim | Oracle: `host:1521/service_name`. Postgres: URL `postgresql://user:senha@host:5432/db` |
| `engine` | não | Engine de banco: `oracle` (default) ou `postgres` |
| `thick` | não | **Só Oracle.** `false` (default) usa modo thin; `true` exige Instant Client |
| `clientLibDir` | não | **Só Oracle.** Libs do client (só thick, caminho não-padrão) |
| `poolMax` | não | Tamanho máximo do pool (default `8`) |
| `readOnly` | não | `true` (default) bloqueia escrita no `run_sql`; leitura sempre liberada |
| `schemaFilter` | não | Array de schemas; `[]` (default) = todos os schemas de usuário. Oracle: MAIÚSCULO (exclui mantidos pela Oracle); Postgres: como `public` (exclui `pg_*` e `information_schema`) |

O cache das interfaces `.ts` não é configurável: é sempre `<pasta do connections.json>/types`
(ex.: `.dba-master/types`). Para ajustar `readOnly`/`schemaFilter`/`poolMax`, edite o JSON
manualmente.

## Registrar num cliente MCP

Ver [agentes.md](agentes.md) para instalação automatizada nos agentes suportados, ou:

```bash
# Claude Code (CLI)
claude mcp add dba-master -- node /caminho/para/dba-master/dist/index.js

# modo dev sem build
claude mcp add dba-master -- npx tsx /caminho/para/dba-master/src/index.ts
```

Claude Desktop, em `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "dba-master": {
      "command": "node",
      "args": ["/caminho/para/dba-master/dist/index.js"]
    }
  }
}
```

## Gerar interfaces do schema

Compila em lote as `interface` TypeScript de todas as tabelas (e views) para
`.dba-master/types/<NOME_DA_CONEXAO>/<OWNER>`. Mesmo estilo do `install` — roda via `npx`, sem clonar:

```bash
npx -y dba-master@latest generate                 # todas as tabelas + views dos schemas acessíveis
npx -y dba-master@latest generate --schema HR     # só o schema HR
npx -y dba-master@latest generate --no-views      # pula views
npx -y dba-master@latest generate --connection prod   # escolhe a conexão nomeada
```

Usa as credenciais do `connections.json` (gravado pelo `install`/`configure`). É
**incremental**: objetos em que o hash do conteúdo gerado for inalterado não são reescritos no sistema de arquivos. Também disponível
via tool MCP `generate_interfaces` para o agente chamar sob demanda.

## Verificação

```bash
npm run typecheck   # tsc --noEmit
npm test            # self-check do mapeamento de tipos e guarda read-only (sem banco)
```

Com um banco Oracle ou PostgreSQL acessível, valide as tools via
[MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```
