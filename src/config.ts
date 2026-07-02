import { dirname, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";

export const DEFAULT_POOL_MAX = 8;

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
    c.poolMax ??= DEFAULT_POOL_MAX;
    c.readOnly ??= true;
    c.schemaFilter ??= [];
  }

  return {
    connections,
    cacheDir: resolve(dirname(usedPath), "types"),
  };
}
