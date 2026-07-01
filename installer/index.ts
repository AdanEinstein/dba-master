import { intro, outro, multiselect, spinner, isCancel, cancel, log, text, select, password as promptPassword, confirm } from "@clack/prompts";
import cfonts from "cfonts";
import fs from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { installMcp } from "./install-mcp.js";
import { installAgents } from "./install-agents.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

  const scope = await select({
    message: "Onde deseja instalar as configurações e dados (escopo)?",
    options: [
      { value: "project", label: "Project scoped (na pasta atual)" },
      { value: "global", label: "Global (no diretório home)" }
    ]
  });
  if (isCancel(scope)) { cancel("Cancelado"); process.exit(0); }

  const isGlobal = scope === "global";
  const dbaMasterDir = isGlobal
    ? resolve(homedir(), ".dba-master")
    : resolve(process.cwd(), ".dba-master");

  if (!fs.existsSync(dbaMasterDir)) {
    fs.mkdirSync(dbaMasterDir, { recursive: true });
  }

  if (!isGlobal) {
    const gitignorePath = resolve(process.cwd(), ".gitignore");
    const ignoreEntry = "\n# DBA-Master\n.dba-master\n";
    if (fs.existsSync(gitignorePath)) {
      const gitignore = fs.readFileSync(gitignorePath, "utf8");
      if (!gitignore.includes(".dba-master")) {
        fs.appendFileSync(gitignorePath, ignoreEntry);
      }
    } else {
      fs.writeFileSync(gitignorePath, ignoreEntry.trim() + "\n");
    }
  }

  // Multi-engine connection setup
  const connectionName = await text({
    message: "Dê um nome para esta conexão (ex: prod_db, homolog, default):",
    placeholder: "default",
    defaultValue: "default"
  });
  if (isCancel(connectionName)) { cancel("Cancelado"); process.exit(0); }

  const engine = await select({
    message: "Selecione o motor de banco de dados (engine):",
    options: [
      { value: "oracle", label: "Oracle Database" }
    ]
  });
  if (isCancel(engine)) { cancel("Cancelado"); process.exit(0); }

  const dbUser = await text({
    message: "Usuário do banco de dados:"
  });
  if (isCancel(dbUser)) { cancel("Cancelado"); process.exit(0); }

  const dbPassword = await promptPassword({
    message: "Senha do banco de dados:"
  });
  if (isCancel(dbPassword)) { cancel("Cancelado"); process.exit(0); }

  const connectString = await text({
    message: "String de conexão (ex: localhost:1521/ORCL):"
  });
  if (isCancel(connectString)) { cancel("Cancelado"); process.exit(0); }

  const jsonPath = resolve(dbaMasterDir, "connections.json");
  let connections: Record<string, any> = {};
  
  if (fs.existsSync(jsonPath)) {
    try {
      const raw = fs.readFileSync(jsonPath, "utf8");
      connections = JSON.parse(raw);
    } catch (e) {
      log.warn(`Arquivo connections.json existe mas não é um JSON válido. Será recriado.`);
    }
    
    if (Object.keys(connections).length > 0) {
      const action = await select({
        message: "O arquivo connections.json já possui conexões configuradas. O que deseja fazer?",
        options: [
          { value: "add", label: `Adicionar/Atualizar a conexão '${connectionName}' mantendo as demais` },
          { value: "overwrite", label: "Sobrescrever o arquivo inteiro apagando outras conexões" }
        ]
      });
      if (isCancel(action)) { cancel("Cancelado"); process.exit(0); }
      
      if (action === "overwrite") {
        connections = {};
      }
    }
  }

  connections[connectionName as string] = {
    engine: engine,
    user: dbUser,
    password: dbPassword,
    connectString: connectString,
    thick: false
  };

  fs.writeFileSync(jsonPath, JSON.stringify(connections, null, 2));
  log.success(`Conexão salva em ${jsonPath}`);

  const s = spinner();
  s.start("Configurando agentes selecionados...");

  const failedAgents: { agent: string, error: unknown }[] = [];

  for (const agent of (agents as string[])) {
    try {
      const args = [`--agent`, agent];
      if (isGlobal) args.push("-g");
      installMcp(args);
      installAgents(args);
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
