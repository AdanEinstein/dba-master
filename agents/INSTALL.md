# Instalação nos agentes de IA

Instala o **dba-master** num agente de IA, em duas vias independentes (combináveis):

1. **Servidor MCP** — expõe a introspecção Oracle como _tools_ MCP (as 9 tools).
2. **Skill/comando `dba-investigate`** — um workflow que ensina o agente a usar as tools
   para investigar o schema e propor soluções.

Scripts cobrem 4 agentes: `claude` · `copilot` · `opencode` · `antigravity`.
Qualquer outro cliente MCP funciona manualmente (ver fim) — o server é STDIO padrão.

> Buildar o projeto e configurar `.env`: ver [../docs/instalacao.md](../docs/instalacao.md).

## 1. Servidor MCP

Pré-requisito: `npm run build` (gera `dist/`) e `.env` preenchido na raiz.

```bash
bash agents/install_mcp.sh                  # todos os agentes
bash agents/install_mcp.sh --agent claude   # só um
```

Comando registrado: `node <proj>/dist/index.js`. Destinos do config:

| Agente          | Arquivo                                  | Tipo |
| --------------- | ---------------------------------------- | ---- |
| Claude Desktop  | `~/.claude/claude_desktop_config.json`   | stdio |
| Claude Code CLI | `~/.claude.json` (por projeto)           | stdio |
| Claude Code VSCode | `<proj>/.vscode/mcp.json`             | stdio |
| Copilot CLI     | `~/.copilot/mcp-config.json`             | local |
| Copilot VS Code | `<proj>/.vscode/mcp.json` (por workspace)| stdio |
| Opencode        | `~/.config/opencode/opencode.json`       | local |
| Antigravity     | `~/.gemini/config/mcp_config.json`       | stdio |

**Claude Code** — recomendado via CLI (não Desktop config):
```bash
claude mcp add dba-master -s user -- node <proj>/dist/index.js
```

O `.env` é lido da raiz do projeto (relativo ao módulo), então não é preciso injetar
credenciais no config de cada agente.

### Qualquer outro cliente MCP (manual)

Transporte STDIO padrão. Cole no config MCP do agente:

```jsonc
{ "command": "node", "args": ["<proj>/dist/index.js"] }
```

Chave do bloco varia por agente: `mcpServers` (claude/antigravity/copilot-cli),
`servers`+`type:stdio` (copilot/claude vscode), `mcp`+`type:local` (opencode).

## 2. Skill/comando `dba-investigate`

```bash
bash agents/install.sh                  # todos os agentes
bash agents/install.sh --agent claude   # só um
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
