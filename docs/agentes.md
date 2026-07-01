# Instalação nos agentes de IA

Scripts em `agents/` instalam o dba-master em agentes de IA, em duas vias combináveis, para
`claude` · `copilot` · `opencode` · `antigravity`. Detalhes completos em
[../agents/INSTALL.md](../agents/INSTALL.md).

## Servidor MCP

Registra o server (`node <proj>/dist/index.js`) no config de cada agente. Requer
`npm run build` e `.env` na raiz.

```bash
bash agents/install_mcp.sh                  # todos
bash agents/install_mcp.sh --agent claude   # só um
```

No Claude Code, o caminho recomendado é a própria CLI:

```bash
claude mcp add dba-master -s user -- node <proj>/dist/index.js
```

## Skill/comando `dba-investigate`

Instala o workflow que orienta o agente a investigar o schema com as tools e propor
soluções. Fonte única em `agents/commands/dba-investigate.md`, adaptada ao formato nativo
de cada agente (slash command, skill pessoal ou workflow). É um subcomando da própria bin:

```bash
npx -y dba-master install-agents                 # via npm (sem o repo)
npx -y dba-master install-agents --agent copilot # só um

node dist/index.js install-agents                # a partir do repo (após npm run build)
```

## Outros clientes MCP (manual)

Transporte STDIO padrão, a partir do repo buildado:

```jsonc
{ "command": "node", "args": ["<proj>/dist/index.js"] }
```

Ou sem o repo, via npm (credenciais no `env`, pois não há `.env` no pacote — ver
[release.md](release.md)):

```jsonc
{ "command": "npx", "args": ["-y", "dba-master"], "env": { "ORACLE_USER": "...", "ORACLE_PASSWORD": "...", "ORACLE_CONNECT_STRING": "host:1521/service_name" } }
```

A chave do bloco varia por cliente (`mcpServers`, `servers`+`type:stdio`, `mcp`+`type:local`).
