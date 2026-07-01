# Instalação nos agentes de IA

Duas vias combináveis, ambas subcomandos da própria bin (via `npx`, sem o repo), para
`claude` · `copilot` · `opencode` · `antigravity`. Detalhes completos em
[../agents/INSTALL.md](../agents/INSTALL.md).

## Servidor MCP

Registra o server (`npx -y dba-master`) no config de cada agente. As credenciais vêm do
ambiente e são gravadas no bloco `env` de cada config (o pacote npx não tem `.env` ao lado);
ausentes viram placeholders `<VAR>` para editar depois.

```bash
DB_USER=usuario DB_PASSWORD=senha DB_CONNECT_STRING=host:1521/service_name \
  npx -y dba-master install-mcp                 # todos
  npx -y dba-master install-mcp --agent claude  # só um
```

Destinos por agente: Claude Desktop (`~/.claude/claude_desktop_config.json`) + Claude Code
(`~/.claude.json`), Copilot CLI (`~/.copilot/mcp-config.json`), Opencode
(`~/.config/opencode/opencode.json`), Antigravity (`~/.gemini/config/mcp_config.json`).

No Claude Code, alternativamente via CLI:

```bash
claude mcp add dba-master -s user \
  -e DB_USER=usuario -e DB_PASSWORD=senha \
  -e DB_CONNECT_STRING=host:1521/service_name \
  -- npx -y dba-master
```

## Skill/comando `dba-investigate`

Instala o workflow que orienta o agente a investigar o schema com as tools e propor
soluções. Fonte única em `agents/commands/dba-investigate.md`, adaptada ao formato nativo
de cada agente (slash command, skill pessoal ou workflow):

```bash
npx -y dba-master install-agents                 # todos
npx -y dba-master install-agents --agent copilot # só um
```

## Outros clientes MCP (manual)

Transporte STDIO padrão, a partir do repo buildado:

```jsonc
{ "command": "node", "args": ["<proj>/dist/index.js"] }
```

Ou sem o repo, via npm (credenciais no `env`, pois não há `.env` no pacote — ver
[release.md](release.md)):

```jsonc
{ "command": "npx", "args": ["-y", "dba-master"], "env": { "DB_USER": "...", "DB_PASSWORD": "...", "DB_CONNECT_STRING": "host:1521/service_name" } }
```

A chave do bloco varia por cliente (`mcpServers`, `servers`+`type:stdio`, `mcp`+`type:local`).
