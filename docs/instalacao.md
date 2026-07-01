# Instalação e configuração

Duas formas: **via npm** (sem clonar, credenciais no ambiente) ou **a partir do repo** (dev).

## Via npm (`npx`)

Não precisa clonar nem buildar. As credenciais vão no bloco `env` do cliente MCP — o pacote
instalado via `npx` **não tem `.env` ao lado**, então a config vem das variáveis de ambiente.
Ver [release.md](release.md) para o snippet completo.

```bash
claude mcp add dba-master \
  -e DB_USER=usuario -e DB_PASSWORD=senha \
  -e DB_CONNECT_STRING=host:1521/service_name \
  -- npx -y dba-master
```

## Setup a partir do repo (dev)

```bash
npm install
cp .env.example .env   # edite com suas credenciais
npm run build          # compila para dist/
```

Modo **thin** (default para Oracle) é JS puro e não exige Instant Client. Só use
`DB_CLIENT_MODE=thick` se precisar de recursos específicos do client nativo.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DB_USER` / `DB_PASSWORD` | sim | Credenciais |
| `DB_CONNECT_STRING` | sim | Ex.: `host:1521/service_name` |
| `DB_ENGINE` | não | Engine de banco (default `oracle`) |
| `DB_CLIENT_MODE` | não | `thin` (default) ou `thick` |
| `DB_CLIENT_LIB_DIR` | não | Libs do client (só thick, caminho não-padrão) |
| `SCHEMA_FILTER` | não | Lista de schemas separada por vírgula; vazio = todos os acessíveis |
| `READ_ONLY` | não | `true` (default) bloqueia escrita no `run_sql`; leitura sempre liberada |
| `CACHE_DIR` | não | Diretório das interfaces `.ts` (default: `.dba-master/types`) |

O `.env` é lido da **raiz do projeto** (relativo ao módulo), então o server acha as
credenciais mesmo quando iniciado por um agente a partir de outro diretório.

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

Compila em lote as `interface` TypeScript de todas as tabelas (e views) para `CACHE_DIR`
(default `.dba-master/types`). Mesmo estilo do `install` — roda via `npx`, sem clonar:

```bash
npx -y dba-master generate                 # todas as tabelas + views dos schemas acessíveis
npx -y dba-master generate --schema HR     # só o schema HR
npx -y dba-master generate --no-views      # pula views
npx -y dba-master generate --connection prod   # escolhe a conexão nomeada
```

Usa as credenciais do `connections.json` (gravado pelo `install`) ou do `.env`. É
**incremental**: objetos com `LAST_DDL_TIME` inalterado não são reescritos. Também disponível
como tool MCP `generate_interfaces` para o agente chamar sob demanda.

## Verificação

```bash
npm run typecheck   # tsc --noEmit
npm test            # self-check do mapeamento de tipos e guarda read-only (sem banco)
```

Com um banco Oracle acessível, valide as tools via
[MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```
