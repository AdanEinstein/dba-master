import { intro, outro, multiselect, spinner, isCancel, cancel, log } from "@clack/prompts";
import cfonts from "cfonts";
import { installMcp } from "./install-mcp.js";
import { installAgents } from "./install-agents.js";

export async function runInstaller() {
  console.clear();
  
  cfonts.say("DBA-MASTER", {
    font: "block",
    align: "left",
    colors: ["#f80", "#f40"],
    background: "transparent",
    letterSpacing: 1,
    lineHeight: 1,
    space: true,
    maxLength: "0",
    gradient: ["red", "blue"],
    independentGradient: false,
    transitionGradient: true,
    env: "node"
  });

  intro("Bem-vindo ao instalador do DBA-Master!");

  const agents = await multiselect({
    message: "Quais agentes de IA você deseja configurar para o dba-master?",
    options: [
      { value: "claude", label: "Claude Desktop / Claude Code" },
      { value: "copilot", label: "Copilot CLI" },
      { value: "opencode", label: "Opencode" },
      { value: "antigravity", label: "Antigravity" }
    ],
    required: true
  });

  if (isCancel(agents)) {
    cancel("Instalação cancelada.");
    process.exit(0);
  }

  const s = spinner();
  s.start("Configurando agentes selecionados...");

  const failedAgents: { agent: string, error: unknown }[] = [];

  for (const agent of (agents as string[])) {
    try {
      installMcp([`--agent`, agent]);
      installAgents([`--agent`, agent]);
    } catch (e) {
      failedAgents.push({ agent, error: e });
    }
  }

  if (failedAgents.length === 0) {
    s.stop("Agentes configurados com sucesso!");
  } else {
    s.stop("Configuração finalizada, mas houve problemas.");
    for (const { agent, error } of failedAgents) {
      log.warn(`Falha ao instalar o agente '${agent}': ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  outro("Instalação concluída! Lembre-se de reiniciar seus agentes.");
}
