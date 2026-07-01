#!/usr/bin/env bash
# Instala a skill/comando dba-investigate nos dirs globais dos agentes de IA.
# Uso: bash agents/install.sh [--agent claude|copilot|opencode|antigravity]
# Sem --agent, instala em todos os agentes suportados.
# ponytail: cp simples + frontmatter por agente; sem engine de template. Fonte em agents/commands/.
set -euo pipefail

# macOS (BSD sed) exige -i '', Linux (GNU sed) não aceita o argumento vazio
if [[ "$(uname -s)" == "Darwin" ]]; then
  sedi() { sed -i '' "$@"; }
else
  sedi() { sed -i "$@"; }
fi

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/commands" && pwd)"
ONLY=""; [[ "${1:-}" == "--agent" ]] && ONLY="${2:-}"; [[ "${1:-}" != "--agent" ]] && ONLY="${1:-}"

CMD="dba-investigate"
DESC="Investiga o schema de um banco via tools MCP do dba-master e propõe soluções (queries, modelagem, diagnóstico)"

want() { [[ -z "$ONLY" || "$ONLY" == "$1" ]]; }
body() { cat "$SRC/$CMD.md"; }

# Comando com frontmatter `description` + corpo. Arg: destfile
with_fm() {
  local dest="$1"
  mkdir -p "$(dirname "$dest")"
  { printf -- '---\ndescription: %s\n---\n\n' "$DESC"; body; } > "$dest"
}

# Skill no formato agentskills (name + description). Arg: destfile
with_skill() {
  local dest="$1"
  mkdir -p "$(dirname "$dest")"
  { printf -- '---\nname: %s\ndescription: %s\n---\n\n' "$CMD" "$DESC"; body; } > "$dest"
}

install_claude() {
  local d="$HOME/.claude/commands"
  with_fm "$d/$CMD.md"
  echo "✓ Claude Code  → $d/$CMD.md"
}

install_copilot() {
  local d="$HOME/.copilot/skills"
  with_skill "$d/$CMD/SKILL.md"
  echo "✓ Copilot      → $d/$CMD/SKILL.md  (skill pessoal, não slash command)"
}

install_opencode() {
  local d="$HOME/.config/opencode/command"
  with_fm "$d/$CMD.md"
  echo "✓ Opencode     → $d/$CMD.md  (confira 'command' vs 'commands' na sua versão)"
}

install_antigravity() {  # workflows; path global não-documentado → best-effort em ~/.gemini/workflows
  if [[ -d "$HOME/.gemini" ]]; then
    local d="$HOME/.gemini/workflows"
    mkdir -p "$d"
    { printf -- '# %s\n\n%s\n\n' "$CMD" "$DESC"; body; } > "$d/$CMD.md"
    echo "✓ Antigravity  → $d/$CMD.md  (⚠️ path global não-documentado; ou crie via UI Customizations→Workflows)"
  else
    echo "↷ Antigravity  → ~/.gemini ausente. Crie o workflow via UI (Customizations→Workflows) com o conteúdo de agents/commands/$CMD.md."
  fi
}

did=0
for a in claude copilot opencode antigravity; do
  if want "$a"; then "install_$a"; did=1; fi
done
[[ "$did" == 1 ]] || { echo "Agente desconhecido: $ONLY"; exit 1; }
echo "Pronto. Reabra/recarregue o agente; no Copilot, o dba-investigate fica disponível como skill pessoal."
