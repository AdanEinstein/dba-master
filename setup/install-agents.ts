// Instala a skill/comando dba-investigate nos dirs globais dos agentes de IA.
// Porta em Node do agents/install.sh, para funcionar quando o pacote é consumido via npx
// (sem o repo). Lê o corpo do .md empacotado em agents/commands/ (ver "files" no package.json).
// ponytail: fs cru + frontmatter por agente; sem engine de template. Fonte única do corpo.
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Skills/comandos que o dba-master instala nos agentes. Fonte do corpo: agents/commands/.
interface Command { cmd: string; desc: string }
const COMMANDS: Command[] = [
  {
    cmd: "dba-investigate",
    desc: "Investiga o schema de um banco via tools MCP do dba-master e propõe soluções (queries, modelagem, diagnóstico)",
  },
  {
    cmd: "dba-wiring",
    desc: "Gate de verificação: garante que toda entrega sobre banco esteja ancorada em output real das tools do dba-master (nada chutado)",
  },
  {
    cmd: "dba-legacy-map",
    desc: "Engenharia reversa de banco legado: reconstrói FKs implícitas, cataloga PL/SQL e jobs, e entrega um mapa do schema",
  },
  {
    cmd: "dba-reprocessor",
    desc: "Planeja reprocessamento/correção de dados em massa fundamentado na estrutura real do banco, via tools MCP do dba-master",
  },
  {
    cmd: "dba-script-gen",
    desc: "Gera SQL de reprocessamento (idempotente, transacional) no dialeto da conexão atual a partir da estrutura confirmada pelas tools do dba-master",
  },
];

const HERE = dirname(fileURLToPath(import.meta.url));

function body(cmd: string): string {
  const dev = resolve(HERE, "..", "agents", "commands", `${cmd}.md`);
  const prod = resolve(HERE, "..", "..", "agents", "commands", `${cmd}.md`);
  return readFileSync(existsSync(dev) ? dev : prod, "utf8");
}

function write(dest: string, content: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content);
}

// ponytail: JSON.stringify → escalar YAML válido (YAML é superset de JSON). Cobre `:`, aspas, `\` sem YAML lib.
const withFm = (dest: string, c: Command) =>
  write(dest, `---\ndescription: ${JSON.stringify(c.desc)}\n---\n\n${body(c.cmd)}`);
const withSkill = (dest: string, c: Command) =>
  write(dest, `---\nname: ${c.cmd}\ndescription: ${JSON.stringify(c.desc)}\n---\n\n${body(c.cmd)}`);

const AGENTS: Record<string, (c: Command, global: boolean) => void> = {
  claude(c, global) {
    const base = global ? homedir() : process.cwd();
    const dest = join(base, ".claude", "commands", `${c.cmd}.md`);
    withFm(dest, c);
    console.log(`✓ Claude Code  → ${dest}`);
  },
  copilot(c, global) {
    const base = global ? homedir() : process.cwd();
    const dest = join(base, ".copilot", "skills", c.cmd, "SKILL.md");
    withSkill(dest, c);
    console.log(`✓ Copilot      → ${dest}  (skill pessoal, não slash command)`);
  },
  opencode(c, global) {
    const dest = global
      ? join(homedir(), ".config", "opencode", "command", `${c.cmd}.md`)
      : join(process.cwd(), ".opencode", "command", `${c.cmd}.md`);
    withFm(dest, c);
    console.log(`✓ Opencode     → ${dest}`);
  },
  antigravity(c, global) {
    if (global) {
      const destGlobal = join(homedir(), ".gemini", "antigravity-cli", "skills", c.cmd, "SKILL.md");
      const destShared = join(homedir(), ".gemini", "skills", c.cmd, "SKILL.md");

      withSkill(destGlobal, c);
      console.log(`✓ Antigravity (Global)    → ${destGlobal}`);

      withSkill(destShared, c);
      console.log(`✓ Antigravity (Shared)    → ${destShared}`);
    } else {
      const destWorkspace = join(process.cwd(), ".agents", "skills", c.cmd, "SKILL.md");
      withSkill(destWorkspace, c);
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
  for (const t of targets) for (const c of COMMANDS) AGENTS[t](c, isGlobal);
  console.log(`Pronto. Reabra/recarregue o agente para ele reindexar os comandos (${isGlobal ? "global" : "project scoped"}).`);
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

const UNINSTALL_AGENTS_SKILL: Record<string, (cmd: string, global: boolean) => void> = {
  claude(cmd, global) {
    const base = global ? homedir() : process.cwd();
    removeFile(join(base, ".claude", "commands", `${cmd}.md`));
  },
  copilot(cmd, global) {
    const base = global ? homedir() : process.cwd();
    removeDir(join(base, ".copilot", "skills", cmd));
  },
  opencode(cmd, global) {
    const dest = global
      ? join(homedir(), ".config", "opencode", "command", `${cmd}.md`)
      : join(process.cwd(), ".opencode", "command", `${cmd}.md`);
    removeFile(dest);
  },
  antigravity(cmd, global) {
    if (global) {
      removeDir(join(homedir(), ".gemini", "antigravity-cli", "skills", cmd));
      removeDir(join(homedir(), ".gemini", "skills", cmd));
    } else {
      removeDir(join(process.cwd(), ".agents", "skills", cmd));
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
  for (const t of targets) for (const c of COMMANDS) UNINSTALL_AGENTS_SKILL[t](c.cmd, isGlobal);
}
