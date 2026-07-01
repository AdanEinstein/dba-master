// Registra o server MCP dba-master nos configs dos agentes de IA.
// Porta em Node do agents/install_mcp.sh, para consumo via npx (sem o repo): registra o
// comando `npx -y dba-master` (não um path local) e injeta as credenciais no bloco `env`,
// pois o pacote npx não tem `.env` ao lado. Credenciais vêm do process.env no momento da
// instalação; ausentes viram placeholders `<VAR>` que o usuário edita depois.
// ponytail: JSON nativo (sem python/jq); só configs globais (~), sem arquivos por-projeto.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const KEY = "dba-master";
const COMMAND = "npx";
const ARGS = ["-y", "dba-master"];

// Variáveis opcionais para o bloco env do MCP.
const OPTIONAL = ["SCHEMA_FILTER", "READ_ONLY"];

function envBlock(): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  for (const k of OPTIONAL) {
    const v = process.env[k];
    if (v) env[k] = v;
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

// Lê/mescla/grava JSON preservando o resto do arquivo. mutate recebe o objeto raiz.
function updateJson(file: string, mutate: (data: Record<string, unknown>) => void): void {
  mkdirSync(dirname(file), { recursive: true });
  let data: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      data = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      console.log(`Aviso: não consegui ler ${file}; recriando.`);
    }
  }
  mutate(data);
  writeFileSync(file, JSON.stringify(data, null, 2));
}

const bag = (data: Record<string, unknown>, key: string) =>
  (data[key] ??= {}) as Record<string, unknown>;

const AGENTS: Record<string, (global: boolean) => void> = {
  claude(global) {
    if (global) {
      // Claude Desktop
      const desktop = join(homedir(), ".claude", "claude_desktop_config.json");
      updateJson(desktop, (d) => {
        bag(d, "mcpServers")[KEY] = { type: "stdio", command: COMMAND, args: ARGS, env: envBlock() };
      });
      console.log(`✓ Claude Desktop  → ${desktop}`);
      // Claude Code (user scope): ~/.claude.json, mcpServers na raiz
      const cli = join(homedir(), ".claude.json");
      updateJson(cli, (d) => {
        bag(d, "mcpServers")[KEY] = { type: "stdio", command: COMMAND, args: ARGS, env: envBlock() };
      });
      console.log(`✓ Claude Code     → ${cli}`);
    } else {
      const cli = join(process.cwd(), ".mcp.json");
      updateJson(cli, (d) => {
        bag(d, "mcpServers")[KEY] = { type: "stdio", command: COMMAND, args: ARGS, env: envBlock() };
      });
      console.log(`✓ Claude Code     → ${cli}`);
    }
  },
  copilot(global) {
    const base = global ? homedir() : process.cwd();
    const f = join(base, ".copilot", "mcp-config.json");
    updateJson(f, (d) => {
      bag(d, "mcpServers")[KEY] = { type: "local", command: COMMAND, args: ARGS, tools: ["*"], env: envBlock() };
    });
    console.log(`✓ Copilot CLI     → ${f}`);
  },
  opencode(global) {
    const f = global 
      ? join(homedir(), ".config", "opencode", "opencode.json")
      : join(process.cwd(), ".opencode", "opencode.json");
    updateJson(f, (d) => {
      d["$schema"] ??= "https://opencode.ai/config.json";
      bag(d, "mcp")[KEY] = { type: "local", command: [COMMAND, ...ARGS], enabled: true, environment: envBlock() };
    });
    console.log(`✓ Opencode        → ${f}`);
  },
  antigravity(global) {
    const f = global 
      ? join(homedir(), ".gemini", "config", "mcp_config.json")
      : join(process.cwd(), ".agents", "mcp_config.json");
    updateJson(f, (d) => {
      bag(d, "mcpServers")[KEY] = { type: "stdio", command: COMMAND, args: ARGS, env: envBlock() };
    });
    console.log(`✓ Antigravity     → ${f}`);
  },
};

export function installMcp(argv: string[]): void {
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

  console.log(`\nServer MCP 'dba-master' registrado (${isGlobal ? "global" : "project scoped"}). Reinicie o agente para carregar.`);
}

function removeFromJson(file: string, mutate: (data: Record<string, unknown>) => void): void {
  if (existsSync(file)) {
    try {
      const data = JSON.parse(readFileSync(file, "utf8"));
      mutate(data);
      writeFileSync(file, JSON.stringify(data, null, 2));
    } catch {
      console.log(`Aviso: não consegui processar ${file}.`);
    }
  }
}

const UNINSTALL_AGENTS: Record<string, (global: boolean) => void> = {
  claude(global) {
    if (global) {
      const desktop = join(homedir(), ".claude", "claude_desktop_config.json");
      removeFromJson(desktop, (d) => { if (d.mcpServers) delete (d.mcpServers as any)[KEY]; });
      console.log(`✓ Removido do Claude Desktop  → ${desktop}`);
      const cli = join(homedir(), ".claude.json");
      removeFromJson(cli, (d) => { if (d.mcpServers) delete (d.mcpServers as any)[KEY]; });
      console.log(`✓ Removido do Claude Code     → ${cli}`);
    } else {
      const cli = join(process.cwd(), ".mcp.json");
      removeFromJson(cli, (d) => { if (d.mcpServers) delete (d.mcpServers as any)[KEY]; });
      console.log(`✓ Removido do Claude Code     → ${cli}`);
    }
  },
  copilot(global) {
    const base = global ? homedir() : process.cwd();
    const f = join(base, ".copilot", "mcp-config.json");
    removeFromJson(f, (d) => { if (d.mcpServers) delete (d.mcpServers as any)[KEY]; });
    console.log(`✓ Removido do Copilot CLI     → ${f}`);
  },
  opencode(global) {
    const f = global 
      ? join(homedir(), ".config", "opencode", "opencode.json")
      : join(process.cwd(), ".opencode", "opencode.json");
    removeFromJson(f, (d) => { if (d.mcp) delete (d.mcp as any)[KEY]; });
    console.log(`✓ Removido do Opencode        → ${f}`);
  },
  antigravity(global) {
    const f = global 
      ? join(homedir(), ".gemini", "config", "mcp_config.json")
      : join(process.cwd(), ".agents", "mcp_config.json");
    removeFromJson(f, (d) => { if (d.mcpServers) delete (d.mcpServers as any)[KEY]; });
    console.log(`✓ Removido do Antigravity     → ${f}`);
  },
};

export function uninstallMcp(argv: string[]): void {
  const isGlobal = argv.includes("-g");
  const filtered = argv.filter((a) => a !== "-g");
  const only = filtered[0] === "--agent" ? filtered[1] : filtered[0];
  const targets = only ? [only] : Object.keys(UNINSTALL_AGENTS);
  const unknown = targets.filter((t) => !UNINSTALL_AGENTS[t]);
  if (unknown.length) {
    console.error(`Agente desconhecido: ${unknown.join(", ")}. Válidos: ${Object.keys(UNINSTALL_AGENTS).join(", ")}.`);
    process.exit(1);
  }
  for (const t of targets) UNINSTALL_AGENTS[t](isGlobal);
}
