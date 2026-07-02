import { dirname, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";

export const DEFAULT_POOL_MAX = 8;

// Transporte opcional: quando o banco só é acessível via bastion/proxy, o driver
// disca numa porta local que a camada tunnel/ encaminha até o destino real. Os
// segredos (chave/senha SSH, credencial de proxy) seguem a mesma indireção ${VAR}
// do resto do config — nunca ficam em texto claro no connections.json.
export type TunnelConfig =
  | {
      type: "ssh";
      host: string;
      port?: number; // default 22
      user: string;
      privateKey?: string; // path do arquivo OU conteúdo PEM (${VAR})
      passphrase?: string;
      password?: string;
      agent?: boolean; // usa SSH_AUTH_SOCK do ambiente
      hostKey?: string; // pin de fingerprint SHA256 (fallback ao known_hosts)
      knownHosts?: string; // path; default ~/.ssh/known_hosts
    }
  | { type: "socks" | "http"; url: string } // ex: socks5://user:pass@host:1080
  | {
      type: "command";
      command: string;
      args?: string[];
      listenHost?: string; // default 127.0.0.1
      listenPort: number; // onde o comando externo escuta
    };

export interface ConnectionConfig {
  engine: string;
  user: string;
  password?: string;
  connectString: string;
  thick?: boolean;
  clientLibDir?: string;
  poolMax?: number;
  readOnly?: boolean;
  schemaFilter?: string[];
  tunnel?: TunnelConfig;
}

export interface Config {
  connections: Record<string, ConnectionConfig>;
  cacheDir: string;
}

// Resolve referências ${VAR} a partir de process.env. Mantém segredos fora do
// connections.json (que o agente de IA consegue ler): o JSON guarda só o nome da
// env var; o valor real vem do ambiente do processo. Var ausente → erro claro.
function interpolateEnv(value: string, connName: string, field: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, varName) => {
    const v = process.env[varName];
    if (v === undefined) {
      throw new Error(
        `Conexão "${connName}", campo "${field}": env var ${varName} não definida.`,
      );
    }
    return v;
  });
}

// Interpola ${VAR} nos campos string do bloco tunnel (segredos SSH/proxy).
function interpolateTunnel(t: TunnelConfig, connName: string): void {
  if (t.type === "ssh") {
    t.user = interpolateEnv(t.user, connName, "tunnel.user");
    if (t.privateKey) t.privateKey = interpolateEnv(t.privateKey, connName, "tunnel.privateKey");
    if (t.passphrase) t.passphrase = interpolateEnv(t.passphrase, connName, "tunnel.passphrase");
    if (t.password) t.password = interpolateEnv(t.password, connName, "tunnel.password");
    if (t.hostKey) t.hostKey = interpolateEnv(t.hostKey, connName, "tunnel.hostKey");
    if (t.knownHosts) t.knownHosts = interpolateEnv(t.knownHosts, connName, "tunnel.knownHosts");
  } else if (t.type === "command") {
    t.command = interpolateEnv(t.command, connName, "tunnel.command");
    if (t.args) t.args = t.args.map((a, i) => interpolateEnv(a, connName, `tunnel.args[${i}]`));
  } else {
    t.url = interpolateEnv(t.url, connName, "tunnel.url");
  }
}

// Fonte única: connections.json (projeto ./.dba-master ou global ~/.dba-master).
// Segredos ficam em env vars referenciadas via ${VAR} (ver interpolateEnv). Se não
// houver conexão, NÃO lança — o server sobe com zero conexões (senão o processo
// morre no boot e o cliente MCP reporta -32000).
export function loadConfig(): Config {
  let connections: Record<string, ConnectionConfig> = {};

  const projectJsonPath = resolve(process.cwd(), ".dba-master", "connections.json");
  const globalJsonPath = resolve(homedir(), ".dba-master", "connections.json");

  let usedPath = projectJsonPath;

  if (existsSync(projectJsonPath)) {
    try {
      connections = JSON.parse(readFileSync(projectJsonPath, "utf8"));
    } catch (e) {
      console.warn(`Aviso: falha ao ler ${projectJsonPath}`, e);
    }
  } else if (existsSync(globalJsonPath)) {
    usedPath = globalJsonPath;
    try {
      connections = JSON.parse(readFileSync(globalJsonPath, "utf8"));
    } catch (e) {
      console.warn(`Aviso: falha ao ler ${globalJsonPath}`, e);
    }
  }

  // Interpola ${VAR} nos campos sensíveis e aplica defaults por conexão.
  for (const [name, c] of Object.entries(connections)) {
    if (c.user) c.user = interpolateEnv(c.user, name, "user");
    if (c.password) c.password = interpolateEnv(c.password, name, "password");
    if (c.connectString) c.connectString = interpolateEnv(c.connectString, name, "connectString");
    if (c.clientLibDir) c.clientLibDir = interpolateEnv(c.clientLibDir, name, "clientLibDir");
    if (c.tunnel) interpolateTunnel(c.tunnel, name);
    c.poolMax ??= DEFAULT_POOL_MAX;
    c.readOnly ??= true;
    c.schemaFilter ??= [];
  }

  return {
    connections,
    cacheDir: resolve(dirname(usedPath), "types"),
  };
}
