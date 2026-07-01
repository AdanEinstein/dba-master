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
npx -y dba-master@latest install
```

Siga as instruções na tela para:
1. Configurar, usar, editar ou gerenciar (excluir) conexões de banco de dados (salvas em `connections.json`).
2. Escolher o escopo da instalação: **Global** (para todos os projetos) ou **Project scoped** (apenas para o projeto atual).
3. Selecionar os agentes desejados (Claude, Copilot, Opencode, Antigravity).

### Destinos do config (Global vs Project scoped)

Dependendo do escopo escolhido, os arquivos de configuração (ex: `mcpServers`) e as skills serão instalados na sua Home (`~`) ou na pasta do seu projeto local. O arquivo `connections.json` será gerado em `~/.dba-master/` (global) ou `./.dba-master/` (projeto).

| Agente          | Arquivo MCP (Global / Local)             | Arquivo de Skill/Command (Global / Local)      |
| --------------- | ---------------------------------------- | ---------------------------------------------- |
| Claude Desktop  | `~/.claude/claude_desktop_config.json`   | N/A                                            |
| Claude Code     | `~/.claude.json` / `./.claude.json`      | `~/.claude/commands/...`                       |
| Copilot CLI     | `~/.copilot/mcp-config.json` / `./.copilot/mcp-config.json` | `~/.copilot/skills/dba-investigate/SKILL.md` / `./.copilot/...` |
| Opencode        | `~/.config/opencode/opencode.json` / `./.opencode/opencode.json` | `~/.config/opencode/command/...` / `./.opencode/command/...` |
| Antigravity     | `~/.gemini/config/mcp_config.json` / `./.agents/mcp_config.json` | `~/.gemini/skills/dba-investigate/SKILL.md` / `./.agents/skills/dba-investigate/SKILL.md` |

**Claude Code** — alternativa via CLI:
```bash
claude mcp add dba-master -s user \
  -e DB_USER=usuario -e DB_PASSWORD=senha \
  -e DB_CONNECT_STRING=host:1521/service_name \
  -- npx -y dba-master
```

### Qualquer outro cliente MCP (manual)

O `dba-master` lê nativamente suas credenciais a partir de `.dba-master/connections.json`. Transporte STDIO padrão. Cole no config MCP do agente:

```jsonc
{ "command": "npx", "args": ["-y", "dba-master"] }
```

Chave do bloco varia por agente: `mcpServers` (claude/antigravity/copilot-cli), `servers`+`type:stdio` (copilot/claude vscode), `mcp`+`type:local` (opencode).

> Antigravity sem `~/.gemini`: crie o workflow pela UI (Customizations → Workflows) com o conteúdo de `agents/commands/dba-investigate.md`.

## 3. Pós-instalação

Reabra/recarregue o agente. Confira que as _tools_ MCP do `dba-master` (ex.: `list_tables`,
`describe_table`) e o comando `/dba-investigate` aparecem.

Detalhes das tools: [../docs/tools.md](../docs/tools.md).
