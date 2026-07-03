import { intro, outro, note, multiselect, spinner, isCancel, cancel, log, text, select, password as promptPassword, confirm } from "@clack/prompts";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
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

// Nome de env var a partir do nome da conexão: DBA_<CONN>_<CAMPO>.
const envVarName = (connName: string, field: string) =>
  `DBA_${connName.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}_${field}`;

// Escapa valor p/ string entre aspas simples do shell POSIX.
const sqEscape = (s: string) => s.replace(/'/g, `'\\''`);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// rc do shell por $SHELL; fallback ~/.profile.
function shellRcPath(): string {
  const sh = process.env.SHELL ?? "";
  if (sh.includes("zsh")) return resolve(homedir(), ".zshrc");
  if (sh.includes("bash")) return resolve(homedir(), ".bashrc");
  return resolve(homedir(), ".profile");
}

// true se o valor já é uma referência ${VAR} (não é plaintext a converter/persistir).
const isRef = (s?: string): boolean => typeof s === "string" && /^\$\{\w+\}$/.test(s);
// Tag que marca as linhas de uma conexão no rc, p/ upsert e remoção idempotentes.
const rcTag = (connName: string) => `# dba-master:${connName}`;
// Nomes de env var referenciados por uma conexão (topo + bloco tunnel). Varre os
// valores ${VAR} realmente presentes — inclui os segredos do túnel. Usado no Windows
// (reg delete por nome); no POSIX a remoção é por tag e cobre tudo da conexão.
function envRefsInConn(conn: any): string[] {
  const names = new Set<string>();
  const scan = (o: any) => {
    for (const v of Object.values(o ?? {})) {
      if (typeof v === "string") { const m = v.match(/^\$\{(\w+)\}$/); if (m) names.add(m[1]); }
      else if (Array.isArray(v)) v.forEach(x => typeof x === "string" && x.match(/^\$\{(\w+)\}$/) && names.add(x.slice(2, -1)));
      else if (v && typeof v === "object") scan(v);
    }
  };
  scan(conn);
  return [...names];
}

// Upsert de env vars no ambiente do usuário. Windows: setx (registro). POSIX: uma
// linha por var no rc, com tag da conexão; substitui a linha da var se já existe.
function upsertEnvVars(connName: string, pairs: Array<[string, string]>): { target: string } {
  if (process.platform === "win32") {
    // ponytail: setx quebra se o valor tiver aspas duplas; raro em creds/URLs. Se virar problema, escapar.
    for (const [v, val] of pairs) execFileSync("setx", [v, val]);
    return { target: "ambiente do usuário (setx) — abra um novo terminal" };
  }
  const rc = shellRcPath();
  const tag = rcTag(connName);
  let lines = fs.existsSync(rc) ? fs.readFileSync(rc, "utf8").split("\n") : [];
  for (const [v, val] of pairs) {
    lines = lines.filter(l => !new RegExp(`^\\s*export ${escapeRe(v)}=`).test(l));
    lines.push(`export ${v}='${sqEscape(val)}' ${tag}`);
  }
  fs.writeFileSync(rc, lines.join("\n").replace(/\n+$/, "") + "\n");
  return { target: rc };
}

// Remove do ambiente do usuário as env vars de uma conexão. Windows: reg delete por
// nome (ignora ausentes). POSIX: dropa toda linha marcada com a tag da conexão.
function removeEnvVars(connName: string, conn: any): { target: string } {
  if (process.platform === "win32") {
    for (const v of envRefsInConn(conn)) {
      try { execFileSync("reg", ["delete", "HKCU\\Environment", "/v", v, "/f"], { stdio: "ignore" }); }
      catch { /* var não existia — ok */ }
    }
    return { target: "ambiente do usuário (reg delete) — abra um novo terminal" };
  }
  const rc = shellRcPath();
  if (!fs.existsSync(rc)) return { target: rc };
  const tag = rcTag(connName);
  const kept = fs.readFileSync(rc, "utf8").split("\n").filter(l => !l.trimEnd().endsWith(tag));
  fs.writeFileSync(rc, kept.join("\n").replace(/\n+$/, "") + "\n");
  return { target: rc };
}

// Núcleo reutilizável: recebe candidatos (campos plaintext a virar ${VAR}), pergunta
// se guarda como referência e se persiste, e aplica a ref via cand.set. Usado tanto
// pelas credenciais do banco quanto pelos segredos do túnel.
async function offerEnvRefs(
  name: string,
  cand: Array<{ field: string; val: string; set: (ref: string) => void }>
): Promise<void> {
  if (cand.length === 0) return;

  const useEnvRefs = await confirm({
    message: "Guardar credenciais como referência a env var? (recomendado — mantém o segredo fora do connections.json, que agentes de IA conseguem ler)",
    initialValue: true
  });
  if (isCancel(useEnvRefs)) { cancel("Cancelado"); process.exit(0); }
  if (!useEnvRefs) return;

  const pairs: Array<[string, string]> = cand.map(c => {
    const v = envVarName(name, c.field);
    c.set(`\${${v}}`);
    return [v, c.val];
  });

  const autoPersist = await confirm({
    message: "Escrever essas env vars automaticamente no seu ambiente? (senão, mostro os comandos para colar)",
    initialValue: false
  });
  if (isCancel(autoPersist)) { cancel("Cancelado"); process.exit(0); }

  const isWin = process.platform === "win32";
  if (autoPersist) {
    const { target } = upsertEnvVars(name, pairs);
    const activate = isWin ? "Abra um novo terminal para valerem." : `Rode: source ${target}  (ou reabra o terminal).`;
    note(
      [`${pairs.length} env var(s) gravadas em: ${target}`, "", activate,
       "Aviso: o segredo fica em texto plano nesse destino — para proteção forte, use um keychain."].join("\n"),
      "Env vars persistidas"
    );
  } else {
    const cmds = pairs.map(([v, val]) => (isWin ? `setx ${v} "${val}"` : `export ${v}='${sqEscape(val)}'`));
    const hint = isWin
      ? "Rode no PowerShell/cmd (setx persiste p/ novos terminais) e reabra o terminal."
      : "Cole no seu ~/.zshrc ou ~/.bashrc e reinicie o shell.";
    note(
      [...cmds, "", hint, "O connections.json guardará apenas as referências ${...}."].join("\n"),
      "Adicione estas env vars ao seu ambiente"
    );
  }
}

// Credenciais do banco: monta candidatos USER/PASS/CS (só plaintext novo) e delega
// ao núcleo. Refs ${...} existentes ficam intactas. Devolve os valores a gravar.
async function applyEnvRefs(
  name: string,
  engine: string,
  vals: { user?: string; password?: string; connectString: string }
): Promise<{ userVal?: string; passVal?: string; csVal: string }> {
  let userVal = vals.user;
  let passVal = vals.password;
  let csVal = vals.connectString;

  const cand: Array<{ field: string; val: string; set: (ref: string) => void }> = [];
  if (engine !== "postgres" && userVal && !isRef(userVal)) cand.push({ field: "USER", val: userVal, set: r => (userVal = r) });
  if (engine !== "postgres" && passVal && !isRef(passVal)) cand.push({ field: "PASS", val: passVal, set: r => (passVal = r) });
  if (csVal && !isRef(csVal)) cand.push({ field: "CS", val: csVal, set: r => (csVal = r) });

  await offerEnvRefs(name, cand);
  return { userVal, passVal, csVal };
}

// Fluxo interativo do túnel/proxy de uma conexão (create/edit). Nem toda conexão
// precisa — pergunta primeiro. Segredos (chave PEM, senha, passphrase, URL de proxy)
// passam pela mesma indireção ${VAR}. Devolve o bloco tunnel ou undefined (sem túnel).
async function configureTunnel(name: string, existing?: any): Promise<any | undefined> {
  const wants = await confirm({
    message: "Este banco só é acessível via túnel/proxy (bastion SSH, SOCKS/HTTP, comando externo)?",
    initialValue: !!existing
  });
  if (isCancel(wants)) { cancel("Cancelado"); process.exit(0); }
  if (!wants) return undefined;

  const type = await select({
    message: "Tipo de túnel:",
    options: [
      { value: "ssh", label: "Túnel SSH (bastion)", hint: "port-forward via host SSH" },
      { value: "socks", label: "Proxy SOCKS5", hint: "socks5://host:1080" },
      { value: "http", label: "Proxy HTTP CONNECT", hint: "http://host:8080" },
      { value: "command", label: "Comando externo", hint: "cloud-sql-proxy, aws ssm..." },
    ],
    initialValue: existing?.type ?? "ssh"
  }) as string;
  if (isCancel(type)) { cancel("Cancelado"); process.exit(0); }

  // Candidatos a env-ref (segredos do túnel) — preenchidos conforme o tipo.
  const cand: Array<{ field: string; val: string; set: (ref: string) => void }> = [];
  const ask = async (msg: string, def = "") => {
    const v = await text({ message: msg, defaultValue: def }) as string;
    if (isCancel(v)) { cancel("Cancelado"); process.exit(0); }
    return v;
  };

  let tunnel: any;

  if (type === "ssh") {
    const host = await ask("Host do bastion SSH:", existing?.host ?? "");
    const portStr = await ask("Porta SSH:", String(existing?.port ?? 22));
    const user = await ask("Usuário SSH:", existing?.user ?? "");
    tunnel = { type: "ssh", host, port: Number(portStr) || 22, user };

    const auth = await select({
      message: "Autenticação SSH:",
      options: [
        { value: "keyfile", label: "Chave privada (arquivo)", hint: "caminho do .pem/id_rsa" },
        { value: "keycontent", label: "Chave privada (conteúdo PEM)", hint: "colar a chave" },
        { value: "password", label: "Senha SSH" },
        { value: "agent", label: "ssh-agent", hint: "usa SSH_AUTH_SOCK" },
      ]
    }) as string;
    if (isCancel(auth)) { cancel("Cancelado"); process.exit(0); }

    if (auth === "keyfile") {
      tunnel.privateKey = await ask("Caminho do arquivo da chave privada:", isRef(existing?.privateKey) ? "" : (existing?.privateKey ?? ""));
      const pp = await promptPassword({ message: "Passphrase da chave (branco = sem):" }) as string;
      if (isCancel(pp)) { cancel("Cancelado"); process.exit(0); }
      if (pp) { tunnel.passphrase = pp; cand.push({ field: "TUNNEL_PASSPHRASE", val: pp, set: r => (tunnel.passphrase = r) }); }
    } else if (auth === "keycontent") {
      const pem = await ask("Cole o conteúdo PEM da chave privada:");
      tunnel.privateKey = pem;
      cand.push({ field: "TUNNEL_KEY", val: pem, set: r => (tunnel.privateKey = r) });
      const pp = await promptPassword({ message: "Passphrase da chave (branco = sem):" }) as string;
      if (isCancel(pp)) { cancel("Cancelado"); process.exit(0); }
      if (pp) { tunnel.passphrase = pp; cand.push({ field: "TUNNEL_PASSPHRASE", val: pp, set: r => (tunnel.passphrase = r) }); }
    } else if (auth === "password") {
      const pw = await promptPassword({ message: "Senha SSH:" }) as string;
      if (isCancel(pw)) { cancel("Cancelado"); process.exit(0); }
      tunnel.password = pw;
      cand.push({ field: "TUNNEL_PASS", val: pw, set: r => (tunnel.password = r) });
    } else {
      tunnel.agent = true;
    }

    const hk = await select({
      message: "Verificação de host key do bastion:",
      options: [
        { value: "known", label: "known_hosts (recomendado)", hint: "~/.ssh/known_hosts" },
        { value: "pin", label: "Pin de fingerprint", hint: "SHA256:..." },
      ]
    }) as string;
    if (isCancel(hk)) { cancel("Cancelado"); process.exit(0); }
    if (hk === "pin") tunnel.hostKey = await ask("Fingerprint SHA256 esperado do host:", existing?.hostKey ?? "");
  } else if (type === "socks" || type === "http") {
    const url = await ask(
      `URL do proxy (ex: ${type === "socks" ? "socks5://user:senha@host:1080" : "http://user:senha@host:8080"}):`,
      isRef(existing?.url) ? "" : (existing?.url ?? "")
    );
    tunnel = { type, url };
    // URL pode conter credenciais → oferecer env-ref.
    if (!isRef(url)) cand.push({ field: "TUNNEL_PROXY_URL", val: url, set: r => (tunnel.url = r) });
  } else {
    const command = await ask("Comando do túnel (binário):", existing?.command ?? "");
    const argsStr = await ask("Argumentos (separados por espaço):", (existing?.args ?? []).join(" "));
    const listenHost = await ask("Host local que o comando escuta:", existing?.listenHost ?? "127.0.0.1");
    const listenPortStr = await ask("Porta local que o comando escuta:", String(existing?.listenPort ?? ""));
    tunnel = {
      type: "command",
      command,
      args: argsStr.trim() ? argsStr.trim().split(/\s+/) : [],
      listenHost,
      listenPort: Number(listenPortStr)
    };
  }

  await offerEnvRefs(name, cand);
  return tunnel;
}

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

  // Remover env vars persistidas das conexões — antes de apagar o connections.json.
  const scopeDir = isGlobal ? resolve(homedir(), ".dba-master") : resolve(process.cwd(), ".dba-master");
  const scopeJson = resolve(scopeDir, "connections.json");
  if (fs.existsSync(scopeJson)) {
    try {
      const conns = JSON.parse(fs.readFileSync(scopeJson, "utf8")) as Record<string, { engine?: string }>;
      const names = Object.keys(conns);
      if (names.length > 0) {
        const dropEnv = await confirm({
          message: `Remover também as env vars persistidas de ${names.length} conexão(ões) do seu ambiente?`,
          initialValue: true
        });
        if (isCancel(dropEnv)) { cancel("Cancelado"); process.exit(0); }
        if (dropEnv) {
          let target = "";
          for (const [name, c] of Object.entries(conns)) target = removeEnvVars(name, c).target;
          const activate = process.platform === "win32" ? "Abra um novo terminal para refletir." : `Rode: source ${target}  (ou reabra o terminal).`;
          note([`Env vars removidas de: ${target}`, "", activate].join("\n"), "Env vars removidas");
        }
      }
    } catch (e) {
      log.warn(`Falha ao remover env vars: ${e instanceof Error ? e.message : String(e)}`);
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
        const delConn = connections[toDelete as string];
        delete connections[toDelete as string];
        fs.writeFileSync(jsonPath, JSON.stringify(connections, null, 2));
        log.success(`Conexão '${toDelete}' excluída.`);

        const dropEnv = await confirm({
          message: "Remover também as env vars desta conexão do seu ambiente?",
          initialValue: true
        });
        if (isCancel(dropEnv)) { cancel("Cancelado"); process.exit(0); }
        if (dropEnv) {
          const { target } = removeEnvVars(toDelete as string, delConn);
          const activate = process.platform === "win32"
            ? "Abra um novo terminal para refletir."
            : `Rode: source ${target}  (ou reabra o terminal).`;
          note([`Env vars da conexão '${toDelete}' removidas de: ${target}`, "", activate].join("\n"), "Env vars removidas");
        }
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
            { value: "mysql", label: "MySQL / MariaDB" },
            { value: "sqlserver", label: "SQL Server (Em breve)", disabled: true }
          ],
          initialValue: connToEdit.engine
        }) as string;
        if (isCancel(editEngine)) { cancel("Cancelado"); process.exit(0); }

        // Postgres: credenciais vêm embutidas na URL de conexão — não pedir user/senha.
        let editDbUser = "";
        let editDbPassword = "";
        const skipAuthPrompt = ["postgres", "mysql"].includes(editEngine);

        if (!skipAuthPrompt) {
          editDbUser = await text({
            message: "Usuário do banco de dados (deixe em branco para manter o atual):"
          }) as string;
          if (isCancel(editDbUser)) { cancel("Cancelado"); process.exit(0); }

          editDbPassword = await promptPassword({
            message: "Senha do banco de dados (deixe em branco para manter a atual):"
          }) as string;
          if (isCancel(editDbPassword)) { cancel("Cancelado"); process.exit(0); }
        } else {
          log.info(`${editEngine === "postgres" ? "PostgreSQL" : "MySQL"}: usuário e senha vêm da própria URL de conexão.`);
        }

        const editConnectString = await text({
          message: `String de conexão (ex: ${connectExample(editEngine)}):`,
          defaultValue: connToEdit.connectString
        }) as string;
        if (isCancel(editConnectString)) { cancel("Cancelado"); process.exit(0); }

        // Branco = mantém o valor atual (inclusive se já for uma ref ${...}).
        // ponytail: troca de engine pode deixar env var órfã (ex: USER/PASS ao virar
        // postgres); export não-usado é inofensivo, ignoramos.
        const { userVal, passVal, csVal } = await applyEnvRefs(toEdit as string, editEngine, {
          user: skipAuthPrompt ? "" : (editDbUser || connToEdit.user),
          password: skipAuthPrompt ? undefined : (editDbPassword || connToEdit.password),
          connectString: editConnectString || connToEdit.connectString
        });

        const editTunnel = await configureTunnel(toEdit as string, connToEdit.tunnel);

        connections[toEdit as string] = {
          engine: editEngine,
          user: skipAuthPrompt ? "" : (userVal ?? ""),
          password: skipAuthPrompt ? undefined : passVal,
          connectString: csVal,
          thick: connToEdit.thick || false,
          ...(editTunnel ? { tunnel: editTunnel } : {})
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
          { value: "mysql", label: "MySQL / MariaDB", hint: "via URL" },
          { value: "sqlserver", label: "SQL Server (Em breve)", disabled: true }
        ]
      }) as string;
      if (isCancel(engine)) { cancel("Cancelado"); process.exit(0); }

      // Postgres e MySQL: credenciais vêm embutidas na URL de conexão
      let dbUser = "";
      let dbPassword: string | undefined;
      const skipNewAuthPrompt = ["postgres", "mysql"].includes(engine);
      if (!skipNewAuthPrompt) {
        dbUser = await text({
          message: "Usuário do banco de dados:"
        }) as string;
        if (isCancel(dbUser)) { cancel("Cancelado"); process.exit(0); }

        dbPassword = await promptPassword({
          message: "Senha do banco de dados:"
        }) as string;
        if (isCancel(dbPassword)) { cancel("Cancelado"); process.exit(0); }
      } else {
        log.info(`${engine === "postgres" ? "PostgreSQL" : "MySQL"}: usuário e senha vêm da própria URL de conexão.`);
      }

      const connectString = await text({
        message: `String de conexão (ex: ${connectExample(engine)}):`
      }) as string;
      if (isCancel(connectString)) { cancel("Cancelado"); process.exit(0); }

      const { userVal, passVal, csVal } = await applyEnvRefs(connectionName as string, engine, {
        user: dbUser,
        password: dbPassword || undefined,
        connectString
      });

      const newTunnel = await configureTunnel(connectionName as string);

      connections[connectionName as string] = {
        engine: engine,
        user: userVal ?? "",
        password: passVal,
        connectString: csVal,
        thick: false,
        ...(newTunnel ? { tunnel: newTunnel } : {})
      };

      fs.writeFileSync(jsonPath, JSON.stringify(connections, null, 2));
      log.success(`Conexão '${connectionName}' salva em ${jsonPath}`);
    }
  }

  outro("Gerenciamento de credenciais concluído.");
}
