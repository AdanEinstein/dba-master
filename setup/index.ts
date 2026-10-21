import { updateSettings, intro, outro, note, multiselect, spinner, isCancel, cancel, log, text, select, password as promptPassword, confirm } from "@clack/prompts";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";
import { parseArgs } from "node:util";

import { installMcp, uninstallMcp, claudeDesktopConfigPath } from "./install-mcp.js";
import { installAgents, uninstallAgents } from "./install-agents.js";
import { showBanner } from "./banner.js";
import { resolveConnection } from "../src/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Textos do clack em português (o rodapé "↑/↓ to navigate" é fixo na lib).
updateSettings({ messages: { cancel: "Cancelado", error: "Algo deu errado" } });
const YN = { active: "Sim", inactive: "Não" };

// Ctrl+C/Esc em qualquer prompt encerra limpo.
function must<T>(v: T | symbol): T {
  if (isCancel(v)) { cancel("Cancelado."); process.exit(0); }
  return v as T;
}

// Exemplo de connectString por engine, mostrado no prompt do configure.
const CONNECT_EXAMPLE: Record<string, string> = {
  oracle: "localhost:1521/ORCL",
  postgres: "postgresql://user:senha@localhost:5432/db",
  mysql: "mysql://user:senha@localhost:3306/db",
  sqlserver: "Server=localhost,1433;Database=db",
};
const connectExample = (engine: string) => CONNECT_EXAMPLE[engine] ?? CONNECT_EXAMPLE.oracle;

const ENGINE_OPTIONS = [
  { value: "oracle", label: "Oracle Database", hint: "usuário + senha + host:porta/serviço" },
  { value: "postgres", label: "PostgreSQL", hint: "tudo numa URL" },
  { value: "mysql", label: "MySQL / MariaDB", hint: "tudo numa URL" },
  { value: "sqlserver", label: "SQL Server (em breve)", disabled: true },
];

// Esconde a senha embutida em URLs (postgresql://u:SENHA@h) ao exibir na tela.
export const maskSecret = (s: string) => s.replace(/(\/\/[^:/@\s]+):[^\s/]*@/, "$1:***@");

// Resumo de uma linha da conexão para listas/hints (senha mascarada).
const describeConn = (c: any) =>
  `${c.engine} · ${maskSecret(c.user ? `${c.user}@${c.connectString}` : c.connectString)}${c.readOnly === false ? " · escrita" : ""}`;

// Escrita por conexão: default read-only; liberar é opt-in explícito, conexão a conexão.
async function askWritable(existing?: { readOnly?: boolean }): Promise<{ readOnly: boolean }> {
  const writable = must(await confirm({ ...YN,
    message: "Permitir escrita nesta conexão? (INSERT/UPDATE/DELETE/DDL e kill session — padrão: só leitura)",
    initialValue: existing?.readOnly === false
  }));
  if (writable) log.warn("Escrita liberada nesta conexão (readOnly: false). As demais seguem read-only.");
  return { readOnly: !writable };
}

// Oracle thick mode: thin não aceita TNS descriptor completo, LDAP nem Advanced
// Security/Wallet. Se sim, pergunta o libDir do Instant Client.
async function askOracleThick(existing?: { thick?: boolean; clientLibDir?: string }): Promise<{ thick: boolean; clientLibDir?: string }> {
  const thick = must(await confirm({ ...YN,
    message: "Usar thick mode (Oracle Instant Client)? Só é preciso para TNS descriptor completo, LDAP ou Wallet",
    initialValue: existing?.thick ?? false
  }));
  if (!thick) return { thick: false };

  const clientLibDir = must(await text({
    message: "Pasta do Instant Client (enter = detectar via ORACLE_HOME/PATH):",
    defaultValue: existing?.clientLibDir ?? ""
  }));
  return { thick: true, ...(clientLibDir ? { clientLibDir } : {}) };
}

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

// Versão atual do pacote (dev: __dirname=setup/, build: __dirname=dist/setup/).
function getCurrentVersion(): string {
  for (const p of [resolve(__dirname, "..", "package.json"), resolve(__dirname, "..", "..", "package.json")]) {
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, "utf8")).version ?? "0.0.0"; } catch { /* tenta próximo candidato */ }
    }
  }
  return "0.0.0";
}

// Compara versões "major.minor.patch": <0 se a<b, 0 se iguais, >0 se a>b.
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
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

type EnvCand = { field: string; val: string; set: (ref: string) => void };

// Recebe os segredos ainda em texto puro e pergunta UMA vez onde guardá-los. Se em
// env var, troca o valor por ${VAR} via cand.set e exporta em process.env (o teste de
// conexão logo após salvar resolve as refs nesta mesma sessão).
async function offerEnvRefs(name: string, cand: EnvCand[]): Promise<void> {
  if (cand.length === 0) return;

  const isWin = process.platform === "win32";
  const how = must(await select({
    message: "Onde guardar usuário, senha e demais segredos desta conexão?",
    options: [
      { value: "auto", label: "Em env vars, gravadas automaticamente (recomendado)", hint: isWin ? "via setx" : `em ${shellRcPath()}` },
      { value: "manual", label: "Em env vars, eu mesmo adiciono", hint: "mostro os comandos para colar" },
      { value: "plain", label: "Direto no connections.json", hint: "agentes de IA conseguem ler esse arquivo" },
    ]
  }));
  if (how === "plain") return;

  const pairs: Array<[string, string]> = cand.map(c => {
    const v = envVarName(name, c.field);
    c.set(`\${${v}}`);
    process.env[v] = c.val;
    return [v, c.val];
  });

  if (how === "auto") {
    const { target } = upsertEnvVars(name, pairs);
    const activate = isWin ? "Abra um novo terminal para valerem." : `Rode: source ${target}  (ou reabra o terminal).`;
    note(
      [`${pairs.length} env var(s) gravadas em: ${target}`, "", activate,
       "Reinicie o agente de IA a partir de um terminal que já tenha essas variáveis.",
       "Aviso: o segredo fica em texto plano nesse destino — para proteção forte, use um keychain."].join("\n"),
      "Env vars persistidas"
    );
  } else {
    const cmds = pairs.map(([v, val]) => (isWin ? `setx ${v} "${val}"` : `export ${v}='${sqEscape(val)}'`));
    const hint = isWin
      ? "Rode no PowerShell/cmd (setx persiste p/ novos terminais) e reabra o terminal."
      : `Cole no seu ${shellRcPath()} e reinicie o shell.`;
    note(
      [...cmds, "", hint, "O connections.json guardará apenas as referências ${...}."].join("\n"),
      "Adicione estas env vars ao seu ambiente"
    );
  }
}

// Fluxo do túnel/proxy (create/edit). Nem toda conexão precisa — pergunta primeiro.
// Devolve o bloco tunnel (ou undefined) e os segredos candidatos a env var, que o
// wizard junta às credenciais do banco para perguntar uma vez só.
async function configureTunnel(existing?: any): Promise<{ tunnel?: any; cand: EnvCand[] }> {
  const cand: EnvCand[] = [];
  const wants = must(await confirm({ ...YN,
    message: "O banco só é acessível via túnel/proxy (bastion SSH, SOCKS/HTTP, comando externo)?",
    initialValue: !!existing
  }));
  if (!wants) return { cand };

  const type = must(await select({
    message: "Tipo de túnel:",
    options: [
      { value: "ssh", label: "Túnel SSH (bastion)", hint: "port-forward via host SSH" },
      { value: "socks", label: "Proxy SOCKS5", hint: "socks5://host:1080" },
      { value: "http", label: "Proxy HTTP CONNECT", hint: "http://host:8080" },
      { value: "command", label: "Comando externo", hint: "cloud-sql-proxy, aws ssm..." },
    ],
    initialValue: existing?.type ?? "ssh"
  }));

  const ask = async (msg: string, def = "") => must(await text({ message: msg, defaultValue: def, placeholder: def || undefined }));
  const askPass = async (msg: string) => must(await promptPassword({ message: msg }));

  let tunnel: any;

  if (type === "ssh") {
    const host = await ask("Host do bastion SSH:", existing?.host ?? "");
    const portStr = await ask("Porta SSH:", String(existing?.port ?? 22));
    const user = await ask("Usuário SSH:", existing?.user ?? "");
    tunnel = { type: "ssh", host, port: Number(portStr) || 22, user };

    const auth = must(await select({
      message: "Autenticação SSH:",
      options: [
        { value: "keyfile", label: "Chave privada (arquivo)", hint: "caminho do .pem/id_rsa" },
        { value: "keycontent", label: "Chave privada (conteúdo PEM)", hint: "colar a chave" },
        { value: "password", label: "Senha SSH" },
        { value: "agent", label: "ssh-agent", hint: "usa SSH_AUTH_SOCK" },
      ]
    }));

    if (auth === "keyfile" || auth === "keycontent") {
      if (auth === "keyfile") {
        tunnel.privateKey = await ask("Caminho do arquivo da chave privada:", isRef(existing?.privateKey) ? "" : (existing?.privateKey ?? ""));
      } else {
        tunnel.privateKey = await ask("Cole o conteúdo PEM da chave privada:");
        cand.push({ field: "TUNNEL_KEY", val: tunnel.privateKey, set: r => (tunnel.privateKey = r) });
      }
      const pp = await askPass("Passphrase da chave (enter = sem passphrase):");
      if (pp) { tunnel.passphrase = pp; cand.push({ field: "TUNNEL_PASSPHRASE", val: pp, set: r => (tunnel.passphrase = r) }); }
    } else if (auth === "password") {
      tunnel.password = await askPass("Senha SSH:");
      cand.push({ field: "TUNNEL_PASS", val: tunnel.password, set: r => (tunnel.password = r) });
    } else {
      tunnel.agent = true;
    }

    const hk = must(await select({
      message: "Verificação de host key do bastion:",
      options: [
        { value: "known", label: "known_hosts (recomendado)", hint: "~/.ssh/known_hosts" },
        { value: "pin", label: "Pin de fingerprint", hint: "SHA256:..." },
      ]
    }));
    if (hk === "pin") tunnel.hostKey = await ask("Fingerprint SHA256 esperado do host:", existing?.hostKey ?? "");
  } else if (type === "socks" || type === "http") {
    const url = await ask(
      `URL do proxy (ex: ${type === "socks" ? "socks5://user:senha@host:1080" : "http://user:senha@host:8080"}):`,
      isRef(existing?.url) ? "" : (existing?.url ?? "")
    );
    tunnel = { type, url };
    // URL pode conter credenciais → candidata a env-ref.
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

  return { tunnel, cand };
}

// Wizard único de create/edit. Na edição, enter mantém o valor atual (mostrado
// mascarado no placeholder). Segredos em texto puro → uma pergunta só no final.
async function connectionWizard(name: string, prev?: any): Promise<any> {
  const engine = must(await select({
    message: "Qual banco de dados?",
    options: ENGINE_OPTIONS,
    initialValue: prev?.engine ?? "oracle"
  }));
  const isOracle = engine === "oracle";
  // Trocou de engine na edição: valores antigos não servem de default.
  const cur = (k: string): string | undefined => (prev?.engine === engine ? prev?.[k] : undefined) || undefined;
  const ask = async (message: string, current?: string) => must(await text({
    message,
    ...(current ? { placeholder: `${maskSecret(current)}  (enter mantém)`, defaultValue: current } : {}),
    validate: v => (!v?.trim() && !current ? "Campo obrigatório." : undefined)
  }));

  let user: string | undefined;
  let password: string | undefined;
  if (isOracle) {
    user = await ask("Usuário do banco:", cur("user"));
    const pw = must(await promptPassword({ message: cur("password") ? "Senha (enter mantém a atual):" : "Senha:" }));
    password = pw || cur("password");
  } else {
    log.info(`${engine === "postgres" ? "PostgreSQL" : "MySQL"}: usuário e senha vão dentro da própria URL.`);
  }
  let connectString = await ask(`${isOracle ? "String de conexão" : "URL de conexão"} (ex: ${connectExample(engine)}):`, cur("connectString"));

  const thick = isOracle ? await askOracleThick(prev?.engine === engine ? prev : undefined) : { thick: false };
  const { tunnel, cand } = await configureTunnel(prev?.tunnel);
  const writable = await askWritable(prev);

  // Refs ${...} já existentes ficam como estão; só texto puro vira candidato.
  if (user && !isRef(user)) cand.push({ field: "USER", val: user, set: r => (user = r) });
  if (password && !isRef(password)) cand.push({ field: "PASS", val: password, set: r => (password = r) });
  if (!isRef(connectString)) cand.push({ field: "CS", val: connectString, set: r => (connectString = r) });
  await offerEnvRefs(name, cand);

  // poolMax/schemaFilter não têm prompt: preserva o que já estava no JSON.
  return {
    engine,
    user: user ?? "",
    password,
    connectString,
    ...thick,
    ...writable,
    ...(prev?.poolMax !== undefined ? { poolMax: prev.poolMax } : {}),
    ...(prev?.schemaFilter !== undefined ? { schemaFilter: prev.schemaFilter } : {}),
    ...(tunnel ? { tunnel } : {})
  };
}

// Abre a conexão e roda SELECT 1, com teto de 20s. Falha não desfaz o save: só avisa.
async function testConnection(name: string, conn: any): Promise<void> {
  const s = spinner();
  s.start(`Testando a conexão '${name}'...`);
  let timer: NodeJS.Timeout | undefined;
  let pm: { closeAll(): Promise<void> } | undefined;
  try {
    const { ProviderManager } = await import("../src/infrastructure/provider-manager.js");
    const resolved = resolveConnection(name, structuredClone(conn));
    const mgr = new ProviderManager({ connections: { [name]: resolved }, cacheDir: tmpdir() });
    pm = mgr;
    const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("sem resposta em 20s")), 20_000); });
    await Promise.race([mgr.getProvider(name).runSql(resolved.engine === "oracle" ? "SELECT 1 FROM DUAL" : "SELECT 1", 1), timeout]);
    s.stop(`Conexão '${name}' OK.`);
  } catch (e) {
    s.error(`Não conectou em '${name}': ${e instanceof Error ? e.message : String(e)}`);
    log.info("A configuração foi salva assim mesmo — corrija em 'Editar conexão' e teste de novo.");
  } finally {
    clearTimeout(timer);
    // ponytail: não espera o close — pool travado (host inalcançável) não pode prender a TUI.
    pm?.closeAll().catch(() => {});
  }
}

// Opções compartilhadas pelos fluxos da TUI — com hint para dar contexto.
const AGENT_OPTIONS = [
  { value: "claude", label: "Claude Desktop / Claude Code", hint: "Desktop e Code" },
  { value: "copilot", label: "Copilot CLI", hint: "GitHub Copilot" },
  { value: "opencode", label: "Opencode", hint: "opencode.ai" },
  { value: "antigravity", label: "Antigravity", hint: "Antigravity IDE" },
  { value: "cursor", label: "Cursor", hint: "Cursor IDE" },
];
const SCOPE_OPTIONS = [
  { value: "project", label: "Projeto — só nesta pasta", hint: "./.dba-master" },
  { value: "global", label: "Global — vale para todas as pastas", hint: "~/.dba-master" },
];
const AGENT_VALUES = AGENT_OPTIONS.map(o => o.value);

// Pasta de config de cada agente no home: se existe, o agente está instalado na máquina.
const AGENT_HOME: Record<string, string> = {
  claude: ".claude", copilot: ".copilot", opencode: ".config/opencode", antigravity: ".gemini", cursor: ".cursor",
};
const detectedAgents = () => AGENT_VALUES.filter(a =>
  fs.existsSync(resolve(homedir(), AGENT_HOME[a])) ||
  (a === "claude" && fs.existsSync(dirname(claudeDesktopConfigPath()))));

// Modo rápido: "--agents claude,cursor" ou "--agents all" → lista validada.
function parseAgents(v?: string): string[] {
  if (!v) throw new Error("--agents é obrigatório no modo rápido (ex: --agents claude,cursor ou --agents all).");
  if (v === "all") return [...AGENT_VALUES];
  const list = v.split(",").map(s => s.trim()).filter(Boolean);
  const bad = list.filter(a => !AGENT_VALUES.includes(a));
  if (bad.length || list.length === 0) throw new Error(`Agente(s) inválido(s): ${bad.join(", ") || v}. Válidos: ${AGENT_VALUES.join(", ")}, all.`);
  return list;
}

// Multiselect de agentes com os detectados na máquina já marcados.
async function askAgents(message: string): Promise<string[]> {
  const found = detectedAgents();
  return must(await multiselect({
    message,
    options: AGENT_OPTIONS.map(o => (found.includes(o.value) ? { ...o, hint: `${o.hint} · detectado` } : o)),
    initialValues: found,
    required: true
  }));
}

const scopeDir = (isGlobal: boolean) =>
  isGlobal ? resolve(homedir(), ".dba-master") : resolve(process.cwd(), ".dba-master");

// Escopo sugerido: onde já há instalação; senão global se rodando do home, senão projeto.
// Devolve true = global.
async function askScope(message: string): Promise<boolean> {
  const has = (g: boolean) => fs.existsSync(scopeDir(g));
  const initialValue = has(false) ? "project" : (has(true) || process.cwd() === homedir()) ? "global" : "project";
  const scope = must(await select({
    message,
    initialValue,
    options: SCOPE_OPTIONS.map(o => (has(o.value === "global") ? { ...o, hint: `${o.hint} · já existe` } : o))
  }));
  return scope === "global";
}

// Cria o diretório de dados do escopo e, no escopo projeto, garante .dba-master no .gitignore.
function ensureScopeDir(isGlobal: boolean): string {
  const dir = scopeDir(isGlobal);
  fs.mkdirSync(dir, { recursive: true });
  if (!isGlobal) {
    const gitignorePath = resolve(process.cwd(), ".gitignore");
    const ignoreEntry = "\n# DBA-Master\n.dba-master\n";
    if (fs.existsSync(gitignorePath)) {
      if (!fs.readFileSync(gitignorePath, "utf8").includes(".dba-master")) fs.appendFileSync(gitignorePath, ignoreEntry);
    } else {
      fs.writeFileSync(gitignorePath, ignoreEntry.trim() + "\n");
    }
  }
  return dir;
}

// connections.json do escopo; inexistente → {}. JSON inválido → avisa e começa vazio.
function readConnections(jsonPath: string): Record<string, any> {
  if (!fs.existsSync(jsonPath)) return {};
  try { return JSON.parse(fs.readFileSync(jsonPath, "utf8")); }
  catch { log.warn(`${jsonPath} não é um JSON válido — será recriado ao salvar.`); return {}; }
}

// Sem args → TUI. Com args → modo rápido (sem prompts): --agents <lista|all> [-g].
export async function runInstaller(args: string[] = []) {
  const fast = args.length > 0;
  const { values } = parseArgs({ args, options: { agents: { type: "string" }, global: { type: "boolean", short: "g" } } });

  if (!fast) {
    console.clear();
    await showBanner({ colors: ["#f80", "#f40"], gradient: ["red", "blue"] });
    intro("Instalador do DBA-Master");
  }

  const agents = fast ? parseAgents(values.agents) : await askAgents("Em quais agentes de IA instalar o dba-master?");
  const isGlobal = fast ? !!values.global : await askScope("Onde guardar as configurações e conexões?");
  const dbaMasterDir = scopeDir(isGlobal);

  const versionFile = resolve(dbaMasterDir, ".version");
  const currentVersion = getCurrentVersion();

  // Modo rápido não pergunta: atualiza direto.
  if (!fast && fs.existsSync(versionFile)) {
    const installedVersion = fs.readFileSync(versionFile, "utf8").trim();
    if (compareVersions(installedVersion, currentVersion) < 0) {
      const update = must(await confirm({ ...YN,
        message: `dba-master v${installedVersion} já está instalado neste escopo. Atualizar para v${currentVersion}?`,
        initialValue: true
      }));
      if (!update) { cancel("Instalação cancelada."); process.exit(0); }
    }
  }

  ensureScopeDir(isGlobal);

  // ponytail: sem spinner — a instalação é síncrona e instantânea, e o spinner
  // embaralhava as linhas "✓ agente → arquivo" que installMcp imprime.
  const failedAgents: { agent: string, error: unknown }[] = [];
  for (const agent of agents) {
    try {
      const a = [`--agent`, agent];
      if (isGlobal) a.push("-g");
      installMcp(a);
      installAgents(a);
    } catch (e) {
      failedAgents.push({ agent, error: e });
    }
  }

  fs.writeFileSync(versionFile, currentVersion);

  for (const { agent, error } of failedAgents) {
    log.warn(`Falha ao instalar no agente '${agent}': ${error instanceof Error ? error.message : String(error)}`);
  }
  if (failedAgents.length < agents.length) log.success("Agentes configurados.");

  // Emenda direto no configure: o usuário não precisa saber do segundo comando.
  const jsonPath = resolve(dbaMasterDir, "connections.json");
  if (!fast) {
    const hasConns = Object.keys(readConnections(jsonPath)).length > 0;
    const now = must(await confirm({ ...YN,
      message: hasConns ? "Revisar as conexões de banco agora?" : "Configurar a conexão com o banco agora?",
      initialValue: !hasConns
    }));
    if (now) await manageConnections(isGlobal);
  }

  const missingConns = Object.keys(readConnections(jsonPath)).length === 0;
  note(
    [
      `Dados e credenciais em:`,
      `  ${dbaMasterDir}`,
      ``,
      `Próximos passos:`,
      ...(missingConns ? [`  • Configure uma conexão:  npx -y dba-master@latest configure`] : []),
      `  • Reinicie ${agents.length > 1 ? "os agentes configurados" : "o agente configurado"} para carregar o dba-master`,
    ].join("\n"),
    "Instalação concluída",
  );
  outro("Tudo pronto — bom proveito! 🚀");
}

// Sem args → TUI. Com args → modo rápido: --agents <lista|all> [-g] [--purge].
// --purge também apaga o .dba-master e as env vars persistidas das conexões.
export async function runUninstaller(args: string[] = []) {
  const fast = args.length > 0;
  const { values } = parseArgs({ args, options: {
    agents: { type: "string" }, global: { type: "boolean", short: "g" }, purge: { type: "boolean" }
  } });

  if (!fast) {
    console.clear();
    await showBanner({ colors: ["#f00", "#f40"], gradient: ["red", "magenta"] });
    intro("Desinstalador do DBA-Master");
  }

  const agents = fast ? parseAgents(values.agents) : await askAgents("De quais agentes de IA remover o dba-master?");
  const isGlobal = fast ? !!values.global : await askScope("De qual escopo remover?");
  const dbaMasterDir = scopeDir(isGlobal);
  const scopeJson = resolve(dbaMasterDir, "connections.json");
  const conns = readConnections(scopeJson);
  const nConns = Object.keys(conns).length;

  // Purge é irreversível (apaga credenciais): uma pergunta só, com o alvo explícito e padrão "não".
  const purge = fast ? !!values.purge : fs.existsSync(dbaMasterDir) && must(await confirm({ ...YN,
    message: `Apagar também os dados em ${dbaMasterDir}${nConns ? ` (${nConns} conexão(ões) e as env vars gravadas para elas)` : ""}? Não dá para desfazer.`,
    initialValue: false
  }));

  const failedAgents: { agent: string, error: unknown }[] = [];
  for (const agent of agents) {
    try {
      const a = [`--agent`, agent];
      if (isGlobal) a.push("-g");
      uninstallMcp(a);
      uninstallAgents(a);
    } catch (e) {
      failedAgents.push({ agent, error: e });
    }
  }
  for (const { agent, error } of failedAgents) {
    log.warn(`Falha ao remover do agente '${agent}': ${error instanceof Error ? error.message : String(error)}`);
  }

  if (purge) {
    // Env vars antes de apagar o connections.json (é dele que sai a lista).
    if (nConns > 0) {
      try {
        let target = "";
        for (const [name, c] of Object.entries(conns)) target = removeEnvVars(name, c).target;
        const activate = process.platform === "win32" ? "Abra um novo terminal para refletir." : `Rode: source ${target}  (ou reabra o terminal).`;
        note([`Env vars removidas de: ${target}`, "", activate].join("\n"), "Env vars removidas");
      } catch (e) {
        log.warn(`Falha ao remover env vars: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    fs.rmSync(dbaMasterDir, { recursive: true, force: true });

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

  note(
    purge
      ? "Configurações dos agentes e diretório de dados removidos."
      : `Configurações dos agentes removidas. Dados mantidos em ${dbaMasterDir}.`,
    "Desinstalação concluída",
  );
  outro("Até a próxima! 👋");
}

// Modo rápido do configure: upsert de UMA conexão, sem prompts. Túnel só pela TUI
// (o bloco tunnel existente é preservado). Lança Error em flag inválida.
function configureFast(v: {
  name?: string; engine?: string; "connect-string"?: string; user?: string; password?: string;
  thick?: boolean; "client-lib-dir"?: string; writable?: boolean; "env-ref"?: boolean; global?: boolean;
}): void {
  const { name, engine } = v;
  if (!name || !engine || !v["connect-string"]) throw new Error("Modo rápido do configure exige --name, --engine e --connect-string.");
  if (!["oracle", "postgres", "mysql"].includes(engine)) throw new Error(`--engine inválido: ${engine}. Válidos: oracle, postgres, mysql.`);
  const isOracle = engine === "oracle";
  if (isOracle && !v.user) throw new Error("Oracle exige --user.");
  if (!isOracle && (v.user || v.password)) throw new Error(`${engine}: usuário e senha vão na própria URL do --connect-string.`);
  if (!isOracle && (v.thick || v["client-lib-dir"])) throw new Error("--thick/--client-lib-dir só valem para Oracle.");

  const jsonPath = resolve(ensureScopeDir(!!v.global), "connections.json");
  // JSON inválido aborta (não sobrescreve às cegas como a TUI).
  const connections: Record<string, any> = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, "utf8")) : {};

  let user = v.user ?? "";
  let password = v.password;
  let connectString = v["connect-string"];
  if (v["env-ref"]) {
    const pairs: Array<[string, string]> = [];
    const ref = (field: string, val: string) => { const n = envVarName(name, field); pairs.push([n, val]); return `\${${n}}`; };
    if (user && !isRef(user)) user = ref("USER", user);
    if (password && !isRef(password)) password = ref("PASS", password);
    if (!isRef(connectString)) connectString = ref("CS", connectString);
    if (pairs.length) {
      const { target } = upsertEnvVars(name, pairs);
      console.log(`✓ ${pairs.length} env var(s) gravadas em ${target}`);
      if (process.platform !== "win32") console.log(`  Rode: source ${target}  (ou reabra o terminal).`);
    }
  }

  const thick = !!v.thick || !!v["client-lib-dir"];
  const prev = connections[name] ?? {};
  connections[name] = {
    engine,
    user,
    password,
    connectString,
    thick: isOracle && thick,
    ...(isOracle && v["client-lib-dir"] ? { clientLibDir: v["client-lib-dir"] } : {}),
    readOnly: !v.writable,
    ...(prev.poolMax !== undefined ? { poolMax: prev.poolMax } : {}),
    ...(prev.schemaFilter !== undefined ? { schemaFilter: prev.schemaFilter } : {}),
    ...(prev.tunnel ? { tunnel: prev.tunnel } : {})
  };
  fs.writeFileSync(jsonPath, JSON.stringify(connections, null, 2));
  console.log(`✓ Conexão '${name}' salva em ${jsonPath} (${v.writable ? "escrita liberada" : "read-only"}). Reinicie o MCP no agente para aplicar.`);
}

// Sem args → TUI. Com args → configureFast (ver flags lá).
export async function runConfigure(args: string[] = []) {
  if (args.length > 0) {
    const { values } = parseArgs({ args, options: {
      name: { type: "string" }, engine: { type: "string" }, "connect-string": { type: "string" },
      user: { type: "string" }, password: { type: "string" }, thick: { type: "boolean" },
      "client-lib-dir": { type: "string" }, writable: { type: "boolean" }, "env-ref": { type: "boolean" },
      global: { type: "boolean", short: "g" }
    } });
    configureFast(values);
    return;
  }

  console.clear();
  await showBanner({ colors: ["#f80", "#f40"], gradient: ["red", "blue"] });
  intro("Conexões de banco do DBA-Master");

  await manageConnections(await askScope("Qual escopo de configuração?"));
  outro("Pronto. Reinicie o MCP no seu agente para aplicar as mudanças.");
}

// Menu de conexões de um escopo. Usado pelo configure e emendado no fim do install.
async function manageConnections(isGlobal: boolean): Promise<void> {
  const jsonPath = resolve(ensureScopeDir(isGlobal), "connections.json");
  const connections = readConnections(jsonPath);
  const save = () => fs.writeFileSync(jsonPath, JSON.stringify(connections, null, 2));
  const pick = async (message: string) => must(await select({
    message,
    options: [
      ...Object.keys(connections).map(k => ({ value: k, label: k, hint: describeConn(connections[k]) })),
      { value: "", label: "← Voltar" }
    ]
  }));

  // Cria (sem editing) ou edita; salva e testa na sequência.
  const upsert = async (editing?: string) => {
    const first = Object.keys(connections).length === 0;
    const name = editing ?? must(await text({
      message: "Nome da conexão (é como o agente vai se referir a ela):",
      placeholder: "ex: prod, homolog",
      ...(first ? { initialValue: "default" } : {}),
      validate: v => {
        const n = v?.trim() ?? "";
        if (!n) return "Informe um nome.";
        if (!/^[\w.-]+$/.test(n)) return "Use só letras, números, _ . ou -";
        if (connections[n]) return `'${n}' já existe — use 'Editar conexão'.`;
      }
    })).trim();
    connections[name] = await connectionWizard(name, editing ? connections[editing] : undefined);
    save();
    log.success(`Conexão '${name}' salva em ${jsonPath} (${connections[name].readOnly ? "só leitura" : "escrita liberada"}).`);
    await testConnection(name, connections[name]);
  };

  // Escopo sem conexões: vai direto para a criação, sem menu no caminho.
  if (Object.keys(connections).length === 0) {
    log.info(`Nenhuma conexão em ${jsonPath} ainda — vamos criar a primeira.`);
    await upsert();
  }

  while (true) {
    const names = Object.keys(connections);
    const action = must(await select({
      message: `Conexões (${names.length}): o que deseja fazer?`,
      options: [
        { value: "done", label: "Concluir" },
        { value: "create", label: "Criar outra conexão" },
        ...(names.length ? [
          { value: "edit", label: "Editar conexão" },
          { value: "test", label: "Testar conexão" },
          { value: "writable", label: "Definir quais conexões aceitam escrita", hint: "padrão: só leitura" },
          { value: "delete", label: "Excluir conexão" },
        ] : []),
      ]
    }));

    if (action === "done") return;
    if (action === "create") { await upsert(); continue; }

    if (action === "edit") {
      const k = await pick("Qual conexão editar?");
      if (k) await upsert(k);
      continue;
    }

    if (action === "test") {
      const k = await pick("Qual conexão testar?");
      if (k) await testConnection(k, connections[k]);
      continue;
    }

    // Atalho só para readOnly: uma tela, sem repassar credenciais/túnel.
    if (action === "writable") {
      const writable = must(await multiselect({
        message: "Marque as conexões que aceitam escrita (desmarcadas = só leitura):",
        options: names.map(k => ({ value: k, label: k, hint: connections[k].engine })),
        initialValues: names.filter(k => connections[k].readOnly === false),
        required: false
      }));
      for (const k of names) connections[k].readOnly = !writable.includes(k);
      save();
      log.success(`Escrita liberada em: ${writable.join(", ") || "nenhuma"}. Demais só leitura.`);
      continue;
    }

    if (action === "delete") {
      const k = await pick("Qual conexão excluir?");
      if (!k) continue;
      const del = connections[k];
      const hasEnv = envRefsInConn(del).length > 0;
      const ok = must(await confirm({ ...YN,
        message: `Excluir '${k}' (${describeConn(del)})${hasEnv ? " e as env vars dela" : ""}? Não dá para desfazer.`,
        initialValue: false
      }));
      if (!ok) continue;
      delete connections[k];
      save();
      // Env var de conexão excluída é órfã: remove junto (só as linhas marcadas pelo dba-master).
      if (hasEnv) {
        const { target } = removeEnvVars(k, del);
        const activate = process.platform === "win32" ? "Abra um novo terminal para refletir." : `Rode: source ${target}  (ou reabra o terminal).`;
        note([`Env vars da conexão '${k}' removidas de: ${target}`, "", activate].join("\n"), "Env vars removidas");
      }
      log.success(`Conexão '${k}' excluída.`);
    }
  }
}
