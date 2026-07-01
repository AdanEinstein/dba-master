import { intro, outro, multiselect, spinner, isCancel, cancel, log, text, select, password as promptPassword, confirm } from "@clack/prompts";
import cfonts from "cfonts";
import fs from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { installMcp, uninstallMcp } from "./install-mcp.js";
import { installAgents, uninstallAgents } from "./install-agents.js";

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

  const jsonPath = resolve(dbaMasterDir, "connections.json");
  let connections: Record<string, any> = {};
  
  if (fs.existsSync(jsonPath)) {
    try {
      const raw = fs.readFileSync(jsonPath, "utf8");
      connections = JSON.parse(raw);
    } catch (e) {
      log.warn(`Arquivo connections.json existe mas não é um JSON válido. Será recriado.`);
    }
  }

  let dbUser = "";
  let dbPassword = "";
  let connectString = "";
  let engine = "";

  let action = "create";
  
  if (Object.keys(connections).length > 0) {
    let manageLoop = true;
    while (manageLoop) {
      const actionSelect = await select({
        message: "Conexões existentes encontradas. O que deseja fazer?",
        options: [
          { value: "use", label: "Usar uma conexão existente" },
          { value: "create", label: "Criar uma nova conexão" },
          { value: "edit", label: "Editar uma conexão existente" },
          { value: "manage", label: "Gerenciar conexões existentes (Excluir)" }
        ]
      });
      if (isCancel(actionSelect)) { cancel("Cancelado"); process.exit(0); }
      action = actionSelect as string;

      if (action === "manage") {
        const toDelete = await select({
          message: "Qual conexão deseja excluir?",
          options: [
            ...Object.keys(connections).map(k => ({ value: k, label: `${k} (${connections[k].user}@${connections[k].connectString})` })),
            { value: "back", label: "Voltar" }
          ]
        });
        if (isCancel(toDelete)) { cancel("Cancelado"); process.exit(0); }
        
        if (toDelete !== "back") {
          delete connections[toDelete as string];
          fs.writeFileSync(jsonPath, JSON.stringify(connections, null, 2));
          log.success(`Conexão '${toDelete}' excluída.`);
        }
        
        if (Object.keys(connections).length === 0) {
          action = "create";
          manageLoop = false;
        }
      } else if (action === "edit") {
        const toEdit = await select({
          message: "Qual conexão deseja editar?",
          options: [
            ...Object.keys(connections).map(k => ({ value: k, label: `${k} (${connections[k].user}@${connections[k].connectString})` })),
            { value: "back", label: "Voltar" }
          ]
        });
        if (isCancel(toEdit)) { cancel("Cancelado"); process.exit(0); }

        if (toEdit !== "back") {
          const connToEdit = connections[toEdit as string];
          const editEngine = await select({
            message: "Selecione o motor de banco de dados (engine):",
            options: [
              { value: "oracle", label: "Oracle Database" }
            ],
            initialValue: connToEdit.engine
          }) as string;
          if (isCancel(editEngine)) { cancel("Cancelado"); process.exit(0); }

          const editDbUser = await text({
            message: "Usuário do banco de dados:",
            defaultValue: connToEdit.user
          }) as string;
          if (isCancel(editDbUser)) { cancel("Cancelado"); process.exit(0); }

          const editDbPassword = await promptPassword({
            message: "Senha do banco de dados (deixe em branco para manter a atual):"
          }) as string;
          if (isCancel(editDbPassword)) { cancel("Cancelado"); process.exit(0); }

          const editConnectString = await text({
            message: "String de conexão (ex: localhost:1521/ORCL):",
            defaultValue: connToEdit.connectString
          }) as string;
          if (isCancel(editConnectString)) { cancel("Cancelado"); process.exit(0); }

          connections[toEdit as string] = {
            engine: editEngine,
            user: editDbUser || connToEdit.user,
            password: editDbPassword || connToEdit.password,
            connectString: editConnectString || connToEdit.connectString,
            thick: connToEdit.thick || false
          };

          fs.writeFileSync(jsonPath, JSON.stringify(connections, null, 2));
          log.success(`Conexão '${toEdit}' atualizada.`);
        }
        // Force the user to choose what to do next
      } else {
        manageLoop = false;
      }
    }
  }

  if (action === "use") {
    const selectedConn = await select({
      message: "Selecione a conexão:",
      options: Object.keys(connections).map(k => ({ value: k, label: `${k} (${connections[k].user}@${connections[k].connectString})` }))
    });
    if (isCancel(selectedConn)) { cancel("Cancelado"); process.exit(0); }
    
    const conn = connections[selectedConn as string];
    dbUser = conn.user;
    dbPassword = conn.password;
    connectString = conn.connectString;
    engine = conn.engine;
  } else if (action === "create") {
    const connectionName = await text({
      message: "Dê um nome para esta nova conexão (ex: prod_db, homolog, default):",
      placeholder: "default",
      defaultValue: "default"
    });
    if (isCancel(connectionName)) { cancel("Cancelado"); process.exit(0); }

    engine = await select({
      message: "Selecione o motor de banco de dados (engine):",
      options: [
        { value: "oracle", label: "Oracle Database" }
      ]
    }) as string;
    if (isCancel(engine)) { cancel("Cancelado"); process.exit(0); }

    dbUser = await text({
      message: "Usuário do banco de dados:"
    }) as string;
    if (isCancel(dbUser)) { cancel("Cancelado"); process.exit(0); }

    dbPassword = await promptPassword({
      message: "Senha do banco de dados:"
    }) as string;
    if (isCancel(dbPassword)) { cancel("Cancelado"); process.exit(0); }

    connectString = await text({
      message: "String de conexão (ex: localhost:1521/ORCL):"
    }) as string;
    if (isCancel(connectString)) { cancel("Cancelado"); process.exit(0); }

    connections[connectionName as string] = {
      engine: engine,
      user: dbUser,
      password: dbPassword,
      connectString: connectString,
      thick: false
    };

    fs.writeFileSync(jsonPath, JSON.stringify(connections, null, 2));
    log.success(`Conexão salva em ${jsonPath}`);
  }

  const s = spinner();
  s.start("Configurando agentes selecionados...");

  // Ponte das respostas do prompt para o process.env — envBlock() em install-mcp.ts
  // lê daqui pra montar o bloco `env` dos configs MCP (senão gravaria placeholders).
  process.env.DB_USER = dbUser as string;
  process.env.DB_PASSWORD = dbPassword as string;
  process.env.DB_CONNECT_STRING = connectString as string;
  process.env.DB_ENGINE = engine as string;

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

export async function runUninstaller() {
  console.clear();
  
  cfonts.say("DBA-MASTER", {
    font: "block",
    align: "left",
    colors: ["#f00", "#f40"],
    background: "transparent",
    letterSpacing: 1,
    lineHeight: 1,
    space: true,
    maxLength: "0",
    gradient: ["red", "magenta"],
    independentGradient: false,
    transitionGradient: true,
    env: "node"
  });

  intro("Desinstalador do DBA-Master");

  const agents = await multiselect({
    message: "De quais agentes de IA você deseja remover o dba-master?",
    options: [
      { value: "claude", label: "Claude Desktop / Claude Code" },
      { value: "copilot", label: "Copilot CLI" },
      { value: "opencode", label: "Opencode" },
      { value: "antigravity", label: "Antigravity" }
    ],
    required: true
  });

  if (isCancel(agents)) {
    cancel("Desinstalação cancelada.");
    process.exit(0);
  }

  const scope = await select({
    message: "De qual escopo deseja remover as configurações e dados?",
    options: [
      { value: "project", label: "Project scoped (na pasta atual)" },
      { value: "global", label: "Global (no diretório home)" }
    ]
  });
  if (isCancel(scope)) { cancel("Cancelado"); process.exit(0); }

  const isGlobal = scope === "global";

  const confirmDelete = await confirm({
    message: `Deseja também apagar o diretório de dados .dba-master (${isGlobal ? "global" : "projeto"})?`,
    initialValue: true
  });
  if (isCancel(confirmDelete)) { cancel("Cancelado"); process.exit(0); }

  const s = spinner();
  s.start("Removendo configurações dos agentes selecionados...");

  const failedAgents: { agent: string, error: unknown }[] = [];

  for (const agent of (agents as string[])) {
    try {
      const args = [`--agent`, agent];
      if (isGlobal) args.push("-g");
      uninstallMcp(args);
      uninstallAgents(args);
    } catch (e) {
      failedAgents.push({ agent, error: e });
    }
  }

  if (confirmDelete) {
    const dbaMasterDir = isGlobal
      ? resolve(homedir(), ".dba-master")
      : resolve(process.cwd(), ".dba-master");
    if (fs.existsSync(dbaMasterDir)) {
      fs.rmSync(dbaMasterDir, { recursive: true, force: true });
    }
    
    // Remover do .gitignore se project scoped
    if (!isGlobal) {
      const gitignorePath = resolve(process.cwd(), ".gitignore");
      if (fs.existsSync(gitignorePath)) {
        let gitignore = fs.readFileSync(gitignorePath, "utf8");
        gitignore = gitignore.replace(/\n# DBA-Master\n\.dba-master\n/g, "");
        fs.writeFileSync(gitignorePath, gitignore);
      }
    }
  }

  if (failedAgents.length === 0) {
    s.stop("Agentes limpos com sucesso!");
  } else {
    s.stop("Desinstalação finalizada, mas houve problemas.");
    for (const { agent, error } of failedAgents) {
      log.warn(`Falha ao remover o agente '${agent}': ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  outro("Desinstalação concluída!");
}

export async function runConfigure() {
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

  intro("Gerenciador de credenciais do DBA-Master");

  const scope = await select({
    message: "Onde deseja gerenciar as configurações (escopo)?",
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

  const jsonPath = resolve(dbaMasterDir, "connections.json");
  let connections: Record<string, any> = {};
  
  if (fs.existsSync(jsonPath)) {
    try {
      connections = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    } catch (e) {
      log.warn(`Arquivo connections.json existe mas não é um JSON válido. Será recriado.`);
    }
  }

  let manageLoop = true;
  while (manageLoop) {
    const actionSelect = await select({
      message: "Gerenciar conexões:",
      options: [
        { value: "create", label: "Criar uma nova conexão" },
        { value: "edit", label: "Editar uma conexão existente" },
        { value: "manage", label: "Excluir conexões existentes" },
        { value: "exit", label: "Sair" }
      ]
    });
    if (isCancel(actionSelect)) { cancel("Cancelado"); process.exit(0); }
    
    if (actionSelect === "exit") {
      manageLoop = false;
      break;
    }

    if (actionSelect === "manage") {
      if (Object.keys(connections).length === 0) {
        log.warn("Nenhuma conexão existente encontrada.");
        continue;
      }
      const toDelete = await select({
        message: "Qual conexão deseja excluir?",
        options: [
          ...Object.keys(connections).map(k => ({ value: k, label: `${k} (${connections[k].user}@${connections[k].connectString})` })),
          { value: "back", label: "Voltar" }
        ]
      });
      if (isCancel(toDelete)) { cancel("Cancelado"); process.exit(0); }
      
      if (toDelete !== "back") {
        delete connections[toDelete as string];
        fs.writeFileSync(jsonPath, JSON.stringify(connections, null, 2));
        log.success(`Conexão '${toDelete}' excluída.`);
      }
    }

    if (actionSelect === "edit") {
      if (Object.keys(connections).length === 0) {
        log.warn("Nenhuma conexão existente encontrada.");
        continue;
      }
      const toEdit = await select({
        message: "Qual conexão deseja editar?",
        options: [
          ...Object.keys(connections).map(k => ({ value: k, label: `${k} (${connections[k].user}@${connections[k].connectString})` })),
          { value: "back", label: "Voltar" }
        ]
      });
      if (isCancel(toEdit)) { cancel("Cancelado"); process.exit(0); }

      if (toEdit !== "back") {
        const connToEdit = connections[toEdit as string];
        const editEngine = await select({
          message: "Selecione o motor de banco de dados (engine):",
          options: [
            { value: "oracle", label: "Oracle Database" }
          ],
          initialValue: connToEdit.engine
        }) as string;
        if (isCancel(editEngine)) { cancel("Cancelado"); process.exit(0); }

        const editDbUser = await text({
          message: "Usuário do banco de dados:",
          defaultValue: connToEdit.user
        }) as string;
        if (isCancel(editDbUser)) { cancel("Cancelado"); process.exit(0); }

        const editDbPassword = await promptPassword({
          message: "Senha do banco de dados (deixe em branco para manter a atual):"
        }) as string;
        if (isCancel(editDbPassword)) { cancel("Cancelado"); process.exit(0); }

        const editConnectString = await text({
          message: "String de conexão (ex: localhost:1521/ORCL):",
          defaultValue: connToEdit.connectString
        }) as string;
        if (isCancel(editConnectString)) { cancel("Cancelado"); process.exit(0); }

        connections[toEdit as string] = {
          engine: editEngine,
          user: editDbUser || connToEdit.user,
          password: editDbPassword || connToEdit.password,
          connectString: editConnectString || connToEdit.connectString,
          thick: connToEdit.thick || false
        };

        fs.writeFileSync(jsonPath, JSON.stringify(connections, null, 2));
        log.success(`Conexão '${toEdit}' atualizada.`);
      }
    }

    if (actionSelect === "create") {
      const connectionName = await text({
        message: "Dê um nome para esta nova conexão (ex: prod_db, homolog, default):",
        placeholder: "default",
        defaultValue: "default"
      });
      if (isCancel(connectionName)) { cancel("Cancelado"); process.exit(0); }

      const engine = await select({
        message: "Selecione o motor de banco de dados (engine):",
        options: [
          { value: "oracle", label: "Oracle Database" }
        ]
      }) as string;
      if (isCancel(engine)) { cancel("Cancelado"); process.exit(0); }

      const dbUser = await text({
        message: "Usuário do banco de dados:"
      }) as string;
      if (isCancel(dbUser)) { cancel("Cancelado"); process.exit(0); }

      const dbPassword = await promptPassword({
        message: "Senha do banco de dados:"
      }) as string;
      if (isCancel(dbPassword)) { cancel("Cancelado"); process.exit(0); }

      const connectString = await text({
        message: "String de conexão (ex: localhost:1521/ORCL):"
      }) as string;
      if (isCancel(connectString)) { cancel("Cancelado"); process.exit(0); }

      connections[connectionName as string] = {
        engine: engine,
        user: dbUser,
        password: dbPassword,
        connectString: connectString,
        thick: false
      };

      fs.writeFileSync(jsonPath, JSON.stringify(connections, null, 2));
      log.success(`Conexão '${connectionName}' salva em ${jsonPath}`);
    }
  }

  outro("Gerenciamento de credenciais concluído.");
}
