import { intro, outro, note, multiselect, spinner, isCancel, cancel, log, text, select, password as promptPassword, confirm } from "@clack/prompts";
import fs from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { installMcp, uninstallMcp } from "./install-mcp.js";
import { installAgents, uninstallAgents } from "./install-agents.js";
import { showBanner } from "./banner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Exemplo de connectString por engine, mostrado no prompt do configure.
const CONNECT_EXAMPLE: Record<string, string> = {
  oracle: "localhost:1521/ORCL",
  postgres: "postgresql://user:senha@localhost:5432/db",
  mysql: "mysql://user:senha@localhost:3306/db",
  sqlserver: "Server=localhost,1433;Database=db",
};
const connectExample = (engine: string) => CONNECT_EXAMPLE[engine] ?? CONNECT_EXAMPLE.oracle;

// Opções compartilhadas pelos fluxos da TUI — com hint para dar contexto.
const AGENT_OPTIONS = [
  { value: "claude", label: "Claude Desktop / Claude Code", hint: "Desktop e Code" },
  { value: "copilot", label: "Copilot CLI", hint: "GitHub Copilot" },
  { value: "opencode", label: "Opencode", hint: "opencode.ai" },
  { value: "antigravity", label: "Antigravity", hint: "Antigravity IDE" },
];
const SCOPE_OPTIONS = [
  { value: "project", label: "Projeto — pasta atual", hint: "./.dba-master" },
  { value: "global", label: "Global — diretório home", hint: "~/.dba-master" },
];

export async function runInstaller() {
  console.clear();

  await showBanner({ colors: ["#f80", "#f40"], gradient: ["red", "blue"] });

  intro("Bem-vindo ao instalador do DBA-Master!");

  const agents = await multiselect({
    message: "Quais agentes de IA você deseja configurar para o dba-master?",
    options: AGENT_OPTIONS,
    required: true
  });

  if (isCancel(agents)) {
    cancel("Instalação cancelada.");
    process.exit(0);
  }

  const scope = await select({
    message: "Onde deseja instalar as configurações e dados (escopo)?",
    options: SCOPE_OPTIONS
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

  note(
    [
      `Dados e credenciais em:`,
      `  ${dbaMasterDir}`,
      ``,
      `Próximos passos:`,
      `  1) Configure as conexões:  npx -y dba-master@latest configure`,
      `  2) Reinicie os agentes que você configurou`,
    ].join("\n"),
    "Instalação concluída",
  );
  outro("Tudo pronto — bom proveito! 🚀");
}

export async function runUninstaller() {
  console.clear();

  await showBanner({ colors: ["#f00", "#f40"], gradient: ["red", "magenta"] });

  intro("Desinstalador do DBA-Master");

  const agents = await multiselect({
    message: "De quais agentes de IA você deseja remover o dba-master?",
    options: AGENT_OPTIONS,
    required: true
  });

  if (isCancel(agents)) {
    cancel("Desinstalação cancelada.");
    process.exit(0);
  }

  const scope = await select({
    message: "De qual escopo deseja remover as configurações e dados?",
    options: SCOPE_OPTIONS
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

  note(
    confirmDelete
      ? "Configurações dos agentes e diretório de dados removidos."
      : "Configurações dos agentes removidas (o diretório de dados foi mantido).",
    "Desinstalação concluída",
  );
  outro("Até a próxima! 👋");
}

export async function runConfigure() {
  console.clear();

  await showBanner({ colors: ["#f80", "#f40"], gradient: ["red", "blue"] });

  intro("Gerenciador de credenciais do DBA-Master");

  const scope = await select({
    message: "Onde deseja gerenciar as configurações (escopo)?",
    options: SCOPE_OPTIONS
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

  note(
    `Arquivo: ${jsonPath}\n${Object.keys(connections).length} conexão(ões) configurada(s)`,
    "Gerenciar conexões",
  );

  let manageLoop = true;
  while (manageLoop) {
    const actionSelect = await select({
      message: "Gerenciar conexões:",
      options: [
        { value: "create", label: "Criar uma nova conexão", hint: "nova credencial" },
        { value: "edit", label: "Editar uma conexão existente", hint: "alterar credencial" },
        { value: "manage", label: "Excluir conexões existentes", hint: "remover credencial" },
        { value: "exit", label: "Sair", hint: "voltar ao terminal" }
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
            { value: "oracle", label: "Oracle Database" },
            { value: "postgres", label: "PostgreSQL" },
            { value: "mysql", label: "MySQL (Em breve)", disabled: true },
            { value: "sqlserver", label: "SQL Server (Em breve)", disabled: true }
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
          message: `String de conexão (ex: ${connectExample(editEngine)}):`,
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
          { value: "oracle", label: "Oracle Database", hint: "thin / thick" },
          { value: "postgres", label: "PostgreSQL", hint: "via URL" },
          { value: "mysql", label: "MySQL (Em breve)", disabled: true },
          { value: "sqlserver", label: "SQL Server (Em breve)", disabled: true }
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
        message: `String de conexão (ex: ${connectExample(engine)}):`
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
