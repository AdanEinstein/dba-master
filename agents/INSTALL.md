# Instalação nos agentes de IA

Instala o **dba-master** num agente de IA, em duas vias independentes (combináveis):

1. **Servidor MCP** — expõe a introspecção Oracle como _tools_ MCP (as 9 tools).
2. **Skill/comando `dba-investigate`** — um workflow que ensina o agente a usar as tools
   para investigar o schema e propor soluções.

Ambas as vias são **subcomandos da própria bin** (via `npx`, sem clonar o repo), cobrindo
4 agentes: `claude` · `copilot` · `opencode` · `antigravity`. Qualquer outro cliente MCP
funciona manualmente (ver fim) — o server é STDIO padrão.

## 1. Servidor MCP

Registra o comando `npx -y dba-master`. As credenciais vêm do ambiente e são gravadas no
bloco `env` de cada config (o pacote npx não tem `.env` ao lado); se ausentes, viram
placeholders `<VAR>` para editar depois.

```bash
ORACLE_USER=usuario ORACLE_PASSWORD=senha ORACLE_CONNECT_STRING=host:1521/service_name \
  npx -y dba-master install-mcp                 # todos os agentes
  npx -y dba-master install-mcp --agent claude  # só um
```

Destinos do config (só globais, no `~`):

| Agente          | Arquivo                                  | Tipo |
| --------------- | ---------------------------------------- | ---- |
| Claude Desktop  | `~/.claude/claude_desktop_config.json`   | stdio |
| Claude Code     | `~/.claude.json` (user scope)            | stdio |
| Copilot CLI     | `~/.copilot/mcp-config.json`             | local |
| Opencode        | `~/.config/opencode/opencode.json`       | local |
| Antigravity     | `~/.gemini/config/mcp_config.json`       | stdio |

**Claude Code** — alternativa via CLI:
```bash
claude mcp add dba-master -s user \
  -e ORACLE_USER=usuario -e ORACLE_PASSWORD=senha \
  -e ORACLE_CONNECT_STRING=host:1521/service_name \
  -- npx -y dba-master
```

### Qualquer outro cliente MCP (manual)

Transporte STDIO padrão. Cole no config MCP do agente (credenciais no `env`):

```jsonc
{ "command": "npx", "args": ["-y", "dba-master"], "env": { "ORACLE_USER": "...", "ORACLE_PASSWORD": "...", "ORACLE_CONNECT_STRING": "host:1521/service_name" } }
```

Chave do bloco varia por agente: `mcpServers` (claude/antigravity/copilot-cli),
`servers`+`type:stdio` (copilot/claude vscode), `mcp`+`type:local` (opencode).

## 2. Skill/comando `dba-investigate`

Subcomando análogo, sem credenciais:

```bash
npx -y dba-master install-agents                 # todos
npx -y dba-master install-agents --agent claude  # só um
```

Fonte em `agents/commands/dba-investigate.md`. Cada agente recebe o formato nativo:

| Agente      | Destino                                        | Formato        |
| ----------- | ---------------------------------------------- | -------------- |
| Claude Code | `~/.claude/commands/dba-investigate.md`        | slash command  |
| Copilot     | `~/.copilot/skills/dba-investigate/SKILL.md`   | skill pessoal  |
| Opencode    | `~/.config/opencode/command/dba-investigate.md`| command        |
| Antigravity | `~/.gemini/workflows/dba-investigate.md`       | workflow ⚠️ path não-doc |

> Antigravity sem `~/.gemini`: crie o workflow pela UI (Customizations → Workflows)
> com o conteúdo de `agents/commands/dba-investigate.md`.

## 3. Pós-instalação

Reabra/recarregue o agente. Confira que as _tools_ MCP do `dba-master` (ex.: `list_tables`,
`describe_table`) e o comando `/dba-investigate` aparecem.

Detalhes das tools: [../docs/tools.md](../docs/tools.md).
