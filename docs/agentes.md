# Instalação nos agentes de IA

Duas vias combináveis, ambas subcomandos da própria bin (via `npx`, sem o repo), para
`claude` · `copilot` · `opencode` · `antigravity`. Detalhes completos em
[../agents/INSTALL.md](../agents/INSTALL.md).

## Instalador Unificado (Interativo)

Registra o server e a skill (`npx -y dba-master@latest install`) na configuração dos agentes escolhidos em um único fluxo iterativo. As credenciais são coletadas nos prompts interativos e gravadas no `connections.json` (projeto ou global) — a config MCP registrada nos agentes **não** tem bloco `env`.

```bash
npx -y dba-master@latest install
```

Destinos por agente: Claude Desktop (`~/.claude/claude_desktop_config.json`) + Claude Code
(`~/.claude.json`), Copilot CLI (`~/.copilot/mcp-config.json`), Opencode
(`~/.config/opencode/opencode.json`), Antigravity (`~/.gemini/config/mcp_config.json`).
O workflow interativo de skill `dba-investigate` também será posicionado nos diretórios de configuração apropriados para o agente escolhido.

No Claude Code, alternativamente via CLI (Apenas servidor MCP — credenciais no `connections.json`, via `npx -y dba-master configure`):

```bash
claude mcp add dba-master -s user -- npx -y dba-master
```

## Outros clientes MCP (manual)

Transporte STDIO padrão, a partir do repo buildado:

```jsonc
{ "command": "node", "args": ["<proj>/dist/index.js"] }
```

Ou sem o repo, via npm (credenciais no `connections.json`, criado com `npx -y dba-master configure` — sem bloco `env`):

```jsonc
{ "command": "npx", "args": ["-y", "dba-master"] }
```

A chave do bloco varia por cliente (`mcpServers`, `servers`+`type:stdio`, `mcp`+`type:local`).
