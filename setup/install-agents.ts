// Instala a skill/comando dba-investigate nos dirs globais dos agentes de IA.
// Porta em Node do agents/install.sh, para funcionar quando o pacote é consumido via npx
// (sem o repo). Lê o corpo do .md empacotado em agents/commands/ (ver "files" no package.json).
// ponytail: fs cru + frontmatter por agente; sem engine de template. Fonte única do corpo.
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CMD = "dba-investigate";
const DESC =
  "Investiga o schema de um banco via tools MCP do dba-master e propõe soluções (queries, modelagem, diagnóstico)";

const HERE = dirname(fileURLToPath(import.meta.url));

const agentPathDev = resolve(HERE, "..", "agents", "commands", `${CMD}.md`);
const agentPathProd = resolve(HERE, "..", "..", "agents", "commands", `${CMD}.md`);
const bodyPath = existsSync(agentPathDev) ? agentPathDev : agentPathProd;

const body = () => readFileSync(bodyPath, "utf8");

function write(dest: string, content: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content);
}

const withFm = (dest: string) => write(dest, `---\ndescription: ${DESC}\n---\n\n${body()}`);
const withSkill = (dest: string) =>
  write(dest, `---\nname: ${CMD}\ndescription: ${DESC}\n---\n\n${body()}`);

const AGENTS: Record<string, (global: boolean) => void> = {
  claude(global) {
    const base = global ? homedir() : process.cwd();
    const dest = join(base, ".claude", "commands", `${CMD}.md`);
    withFm(dest);
    console.log(`✓ Claude Code  → ${dest}`);
  },
  copilot(global) {
    const base = global ? homedir() : process.cwd();
    const dest = join(base, ".copilot", "skills", CMD, "SKILL.md");
    withSkill(dest);
    console.log(`✓ Copilot      → ${dest}  (skill pessoal, não slash command)`);
  },
  opencode(global) {
    const dest = global 
      ? join(homedir(), ".config", "opencode", "command", `${CMD}.md`)
      : join(process.cwd(), ".opencode", "command", `${CMD}.md`);
    withFm(dest);
    console.log(`✓ Opencode     → ${dest}`);
  },
  antigravity(global) {
    if (global) {
      const destGlobal = join(homedir(), ".gemini", "antigravity-cli", "skills", CMD, "SKILL.md");
      const destShared = join(homedir(), ".gemini", "skills", CMD, "SKILL.md");

      withSkill(destGlobal);
      console.log(`✓ Antigravity (Global)    → ${destGlobal}`);

      withSkill(destShared);
      console.log(`✓ Antigravity (Shared)    → ${destShared}`);
    } else {
      const destWorkspace = join(process.cwd(), ".agents", "skills", CMD, "SKILL.md");
      withSkill(destWorkspace);
      console.log(`✓ Antigravity (Workspace) → ${destWorkspace}`);
    }
  },
};

export function installAgents(argv: string[]): void {
  // aceita "--agent claude" ou só "claude"; aceita "-g" para escopo global
  const isGlobal = argv.includes("-g");
  const filtered = argv.filter((a) => a !== "-g");
  const only = filtered[0] === "--agent" ? filtered[1] : filtered[0];
  const targets = only ? [only] : Object.keys(AGENTS);
  const unknown = targets.filter((t) => !AGENTS[t]);
  if (unknown.length) {
    console.error(`Agente desconhecido: ${unknown.join(", ")}. Válidos: ${Object.keys(AGENTS).join(", ")}.`);
    process.exit(1);
  }
  for (const t of targets) AGENTS[t](isGlobal);
  console.log(`Pronto. Reabra/recarregue o agente para ele reindexar o comando (${isGlobal ? "global" : "project scoped"}).`);
}

function removeFile(file: string) {
  if (existsSync(file)) {
    unlinkSync(file);
    console.log(`✓ Removido comando → ${file}`);
  }
}

function removeDir(dir: string) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    console.log(`✓ Removido diretório → ${dir}`);
  }
}

const UNINSTALL_AGENTS_SKILL: Record<string, (global: boolean) => void> = {
  claude(global) {
    const base = global ? homedir() : process.cwd();
    removeFile(join(base, ".claude", "commands", `${CMD}.md`));
  },
  copilot(global) {
    const base = global ? homedir() : process.cwd();
    removeDir(join(base, ".copilot", "skills", CMD));
  },
  opencode(global) {
    const dest = global 
      ? join(homedir(), ".config", "opencode", "command", `${CMD}.md`)
      : join(process.cwd(), ".opencode", "command", `${CMD}.md`);
    removeFile(dest);
  },
  antigravity(global) {
    if (global) {
      removeDir(join(homedir(), ".gemini", "antigravity-cli", "skills", CMD));
      removeDir(join(homedir(), ".gemini", "skills", CMD));
    } else {
      removeDir(join(process.cwd(), ".agents", "skills", CMD));
    }
  },
};

export function uninstallAgents(argv: string[]): void {
  const isGlobal = argv.includes("-g");
  const filtered = argv.filter((a) => a !== "-g");
  const only = filtered[0] === "--agent" ? filtered[1] : filtered[0];
  const targets = only ? [only] : Object.keys(UNINSTALL_AGENTS_SKILL);
  const unknown = targets.filter((t) => !UNINSTALL_AGENTS_SKILL[t]);
  if (unknown.length) {
    console.error(`Agente desconhecido: ${unknown.join(", ")}. Válidos: ${Object.keys(UNINSTALL_AGENTS_SKILL).join(", ")}.`);
    process.exit(1);
  }
  for (const t of targets) UNINSTALL_AGENTS_SKILL[t](isGlobal);
}
