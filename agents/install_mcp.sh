#!/usr/bin/env bash
# Instala o servidor MCP dba-master nos agentes de IA (local, via node dist/index.js).
# Uso: bash agents/install_mcp.sh [--agent claude|copilot|opencode|antigravity]
# Sem --agent, instala em todos os agentes suportados.
# Pré-requisito: `npm run build` (gera dist/) e `.env` preenchido na raiz.
set -euo pipefail

PROJ_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ONLY=""; [[ "${1:-}" == "--agent" ]] && ONLY="${2:-}"; [[ "${1:-}" != "--agent" ]] && ONLY="${1:-}"
export PROJ_DIR

[[ -f "$PROJ_DIR/dist/index.js" ]] || echo "⚠️  $PROJ_DIR/dist/index.js não existe — rode 'npm run build' antes."

# Atualiza JSON com segurança sem depender de jq. Args: arquivo, tipo-de-agente.
python_update_json() {
  local target_file="$1" agent_type="$2"
  python3 -c "
import sys, json, os
from pathlib import Path

target_file, agent_type = sys.argv[1], sys.argv[2]
proj_dir = os.environ['PROJ_DIR']
command = 'node'
args = [os.path.join(proj_dir, 'dist', 'index.js')]

fp = Path(target_file)
fp.parent.mkdir(parents=True, exist_ok=True)

data = {}
if fp.exists():
    try:
        data = json.loads(fp.read_text())
    except Exception as e:
        print(f'Aviso: não foi possível ler {target_file}: {e}. Criando novo.')

mcp_key = 'servers' if agent_type == 'copilot-vscode' else 'mcp' if agent_type == 'opencode' else 'mcpServers'
data.setdefault(mcp_key, {})

if agent_type == 'opencode':
    data[mcp_key]['dba-master'] = {'type': 'local', 'command': [command] + args, 'enabled': True}
    data.setdefault('\$schema', 'https://opencode.ai/config.json')
elif agent_type == 'copilot-cli':
    data[mcp_key]['dba-master'] = {'type': 'local', 'command': command, 'args': args, 'tools': ['*']}
else:  # claude, antigravity, copilot-vscode
    data[mcp_key]['dba-master'] = {'type': 'stdio', 'command': command, 'args': args}

fp.write_text(json.dumps(data, indent=2))
" "$target_file" "$agent_type"
}

want() { [[ -z "$ONLY" || "$ONLY" == "$1" ]]; }

install_claude() {
  local f_desktop="$HOME/.claude/claude_desktop_config.json"
  python_update_json "$f_desktop" "claude"
  echo "✓ Claude Desktop → $f_desktop"

  # Claude Code CLI — scope local grava em ~/.claude.json por projeto
  python3 -c "
import sys, json, os
from pathlib import Path
proj_dir = sys.argv[1]
f = Path.home() / '.claude.json'
d = json.loads(f.read_text()) if f.exists() else {}
proj = d.setdefault('projects', {}).setdefault(proj_dir, {})
proj.setdefault('mcpServers', {})['dba-master'] = {
    'type': 'stdio', 'command': 'node', 'args': [os.path.join(proj_dir, 'dist', 'index.js')]
}
f.write_text(json.dumps(d, indent=2))
" "$PROJ_DIR"
  echo "✓ Claude Code CLI → $HOME/.claude.json [projeto: $PROJ_DIR]"

  local f_vscode="$PROJ_DIR/.vscode/mcp.json"
  python_update_json "$f_vscode" "copilot-vscode"
  echo "✓ Claude Code VSCode → $f_vscode"

  local f_settings="$PROJ_DIR/.claude/settings.local.json"
  python3 -c "
import sys, json
from pathlib import Path
f = Path(sys.argv[1])
f.parent.mkdir(parents=True, exist_ok=True)
data = json.loads(f.read_text()) if f.exists() else {}
servers = data.setdefault('enabledMcpjsonServers', [])
if 'dba-master' not in servers: servers.append('dba-master')
f.write_text(json.dumps(data, indent=2))
" "$f_settings"
  echo "✓ enabledMcpjsonServers → $f_settings"
}

install_copilot() {
  local f_cli="$HOME/.copilot/mcp-config.json"
  python_update_json "$f_cli" "copilot-cli"
  echo "✓ Copilot CLI    → $f_cli"

  local f_vscode="$PROJ_DIR/.vscode/mcp.json"
  python_update_json "$f_vscode" "copilot-vscode"
  echo "✓ Copilot VSCode → $f_vscode (por Workspace)"
}

install_opencode() {
  local f="$HOME/.config/opencode/opencode.json"
  python_update_json "$f" "opencode"
  echo "✓ Opencode       → $f"
}

install_antigravity() {
  local f="$HOME/.gemini/config/mcp_config.json"
  python_update_json "$f" "antigravity"
  echo "✓ Antigravity    → $f"
}

did=0
for a in claude copilot opencode antigravity; do
  if want "$a"; then "install_$a"; did=1; fi
done
[[ "$did" == 1 ]] || { echo "Agente desconhecido: $ONLY"; exit 1; }
echo ""
echo "Server MCP 'dba-master' instalado. Reinicie o agente para carregar."
echo "Claude Code (recomendado via CLI): claude mcp add dba-master -s user -- node $PROJ_DIR/dist/index.js"
