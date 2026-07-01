# Instalação nos agentes de IA

Duas vias combináveis, ambas subcomandos da própria bin (via `npx`, sem o repo), para
`claude` · `copilot` · `opencode` · `antigravity`. Detalhes completos em
[../agents/INSTALL.md](../agents/INSTALL.md).

## Instalador Unificado (Interativo)

Registra o server e a skill (`npx -y dba-master install`) na configuração dos agentes escolhidos em um único fluxo iterativo. As credenciais vêm do ambiente e são gravadas no bloco `env` de cada config (o pacote npx não tem `.env` ao lado); ausentes viram placeholders `<VAR>` para editar depois.

```bash
DB_USER=usuario DB_PASSWORD=senha DB_CONNECT_STRING=host:1521/service_name \
  npx -y dba-master install
```

Destinos por agente: Claude Desktop (`~/.claude/claude_desktop_config.json`) + Claude Code
(`~/.claude.json`), Copilot CLI (`~/.copilot/mcp-config.json`), Opencode
(`~/.config/opencode/opencode.json`), Antigravity (`~/.gemini/config/mcp_config.json`).
O workflow interativo de skill `dba-investigate` também será posicionado nos diretórios de configuração apropriados para o agente escolhido.

No Claude Code, alternativamente via CLI (Apenas servidor MCP):

```bash
claude mcp add dba-master -s user \
  -e DB_USER=usuario -e DB_PASSWORD=senha \
  -e DB_CONNECT_STRING=host:1521/service_name \
  -- npx -y dba-master
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
