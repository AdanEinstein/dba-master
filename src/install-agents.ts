// Instala a skill/comando dba-investigate nos dirs globais dos agentes de IA.
// Porta em Node do agents/install.sh, para funcionar quando o pacote é consumido via npx
// (sem o repo). Lê o corpo do .md empacotado em agents/commands/ (ver "files" no package.json).
// ponytail: fs cru + frontmatter por agente; sem engine de template. Fonte única do corpo.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CMD = "dba-investigate";
const DESC =
  "Investiga o schema de um banco via tools MCP do dba-master e propõe soluções (queries, modelagem, diagnóstico)";

const HERE = dirname(fileURLToPath(import.meta.url));
// dist/install-agents.js → <pkgroot>/agents/commands/... (npm); src via tsx → <repo>/agents/commands/...
const body = () => readFileSync(resolve(HERE, "..", "agents", "commands", `${CMD}.md`), "utf8");

function write(dest: string, content: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content);
}

const withFm = (dest: string) => write(dest, `---\ndescription: ${DESC}\n---\n\n${body()}`);
const withSkill = (dest: string) =>
  write(dest, `---\nname: ${CMD}\ndescription: ${DESC}\n---\n\n${body()}`);

const AGENTS: Record<string, () => void> = {
  claude() {
    const dest = join(homedir(), ".claude", "commands", `${CMD}.md`);
    withFm(dest);
    console.log(`✓ Claude Code  → ${dest}`);
  },
  copilot() {
    const dest = join(homedir(), ".copilot", "skills", CMD, "SKILL.md");
    withSkill(dest);
    console.log(`✓ Copilot      → ${dest}  (skill pessoal, não slash command)`);
  },
  opencode() {
    const dest = join(homedir(), ".config", "opencode", "command", `${CMD}.md`);
    withFm(dest);
    console.log(`✓ Opencode     → ${dest}`);
  },
  antigravity() {
    // workflows; path global não-documentado → best-effort em ~/.gemini/workflows
    const gemini = join(homedir(), ".gemini");
    if (existsSync(gemini)) {
      const dest = join(gemini, "workflows", `${CMD}.md`);
      write(dest, `# ${CMD}\n\n${DESC}\n\n${body()}`);
      console.log(`✓ Antigravity  → ${dest}  (⚠️ path global não-doc; ou crie via UI Customizations→Workflows)`);
    } else {
      console.log(`↷ Antigravity  → ~/.gemini ausente. Crie o workflow via UI (Customizations→Workflows) com o conteúdo de ${CMD}.md.`);
    }
  },
};

export function installAgents(argv: string[]): void {
  // aceita "--agent claude" ou só "claude"; sem nada = todos
  const only = argv[0] === "--agent" ? argv[1] : argv[0];
  const targets = only ? [only] : Object.keys(AGENTS);
  const unknown = targets.filter((t) => !AGENTS[t]);
  if (unknown.length) {
    console.error(`Agente desconhecido: ${unknown.join(", ")}. Válidos: ${Object.keys(AGENTS).join(", ")}.`);
    process.exit(1);
  }
  for (const t of targets) AGENTS[t]();
  console.log("Pronto. Reabra/recarregue o agente para ele reindexar o comando.");
}
