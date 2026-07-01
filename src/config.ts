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

// Fonte única: connections.json (projeto ./.dba-master ou global ~/.dba-master).
// Sem .env / process.env. Se não houver conexão, NÃO lança — o server sobe com
// zero conexões (senão o processo morre no boot e o cliente MCP reporta -32000).
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

  // Defaults por conexão.
  for (const c of Object.values(connections)) {
    c.poolMax ??= DEFAULT_POOL_MAX;
    c.readOnly ??= true;
    c.schemaFilter ??= [];
  }

  return {
    connections,
    cacheDir: resolve(dirname(usedPath), "types"),
  };
}
