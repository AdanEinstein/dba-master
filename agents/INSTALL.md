# Instalação nos agentes de IA

Instala o **dba-master** num agente de IA, em duas vias independentes (combináveis):

1. **Servidor MCP** — expõe a introspecção de banco de dados como _tools_ MCP (as 9 tools).
2. **Skill/comando `dba-investigate`** — um workflow que ensina o agente a usar as tools
   para investigar o schema e propor soluções.

Ambas as vias são **subcomandos da própria bin** (via `npx`, sem clonar o repo), cobrindo
4 agentes: `claude` · `copilot` · `opencode` · `antigravity`. Qualquer outro cliente MCP
funciona manualmente (ver fim) — o server é STDIO padrão.

## Instalação Unificada (Interativa)

O novo instalador interativo configura tanto o servidor MCP quanto as skills/comandos para os agentes que você escolher.

```bash
DB_USER=usuario DB_PASSWORD=senha DB_CONNECT_STRING=host:1521/service_name \
  npx -y dba-master install
```

Siga as instruções na tela para selecionar os agentes desejados (Claude, Copilot, Opencode, Antigravity). As credenciais vêm do ambiente e são gravadas no bloco `env` de cada config; se ausentes, viram placeholders `<VAR>` para editar depois.

### Destinos do config (só globais, no `~`):

| Agente          | Arquivo MCP                              | Arquivo de Skill/Command                       |
| --------------- | ---------------------------------------- | ---------------------------------------------- |
| Claude Desktop  | `~/.claude/claude_desktop_config.json`   | N/A                                            |
| Claude Code     | `~/.claude.json` (user scope)            | `~/.claude/commands/dba-investigate.md`        |
| Copilot CLI     | `~/.copilot/mcp-config.json`             | `~/.copilot/skills/dba-investigate/SKILL.md`   |
| Opencode        | `~/.config/opencode/opencode.json`       | `~/.config/opencode/command/dba-investigate.md`|
| Antigravity     | `~/.gemini/config/mcp_config.json`       | `~/.gemini/workflows/dba-investigate.md`       |

**Claude Code** — alternativa via CLI:
```bash
claude mcp add dba-master -s user \
  -e DB_USER=usuario -e DB_PASSWORD=senha \
  -e DB_CONNECT_STRING=host:1521/service_name \
  -- npx -y dba-master
```

### Qualquer outro cliente MCP (manual)

Transporte STDIO padrão. Cole no config MCP do agente (credenciais no `env`):

```jsonc
{ "command": "npx", "args": ["-y", "dba-master"], "env": { "DB_USER": "...", "DB_PASSWORD": "...", "DB_CONNECT_STRING": "host:1521/service_name" } }
```

Chave do bloco varia por agente: `mcpServers` (claude/antigravity/copilot-cli), `servers`+`type:stdio` (copilot/claude vscode), `mcp`+`type:local` (opencode).

> Antigravity sem `~/.gemini`: crie o workflow pela UI (Customizations → Workflows) com o conteúdo de `agents/commands/dba-investigate.md`.

## 3. Pós-instalação

Reabra/recarregue o agente. Confira que as _tools_ MCP do `dba-master` (ex.: `list_tables`,
`describe_table`) e o comando `/dba-investigate` aparecem.

Detalhes das tools: [../docs/tools.md](../docs/tools.md).
