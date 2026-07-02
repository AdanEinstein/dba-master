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
As skills `dba-investigate`, `dba-wiring`, `dba-legacy-map`, `dba-reprocessor` e `dba-script-gen` também serão posicionadas nos diretórios de configuração apropriados para o agente escolhido:

- `dba-investigate` — investiga o schema (do estreito ao amplo) e propõe queries/modelagem/diagnóstico.
- `dba-legacy-map` — engenharia reversa de banco legado: reconstrói FKs implícitas (`infer_relationships`), cataloga PL/SQL e jobs, entrega um mapa do schema.
- `dba-wiring` — gate de verificação: garante que toda entrega esteja ancorada em output real das tools (nada chutado).
- `dba-reprocessor` — Planeja reprocessamento/correção de dados em massa fundamentado na estrutura real do banco, via tools MCP do dba-master.
- `dba-script-gen` — Gera SQL de reprocessamento (idempotente, transacional) no dialeto da conexão atual a partir da estrutura confirmada pelas tools do dba-master.

No Claude Code, alternativamente via CLI (Apenas servidor MCP — credenciais no `connections.json`, via `npx -y dba-master@latest configure`):

```bash
claude mcp add dba-master -s user -- npx -y dba-master@latest
```

## Outros clientes MCP (manual)

Transporte STDIO padrão, a partir do repo buildado:

```jsonc
{ "command": "node", "args": ["<proj>/dist/index.js"] }
```

Ou sem o repo, via npm (credenciais no `connections.json`, criado com `npx -y dba-master@latest configure` — sem bloco `env`):

```jsonc
{ "command": "npx", "args": ["-y", "dba-master@latest"] }
```

A chave do bloco varia por cliente (`mcpServers`, `servers`+`type:stdio`, `mcp`+`type:local`).
