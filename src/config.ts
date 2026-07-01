import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_POOL_MAX = 8;

export interface ConnectionConfig {
  engine: string;
  user: string;
  password?: string;
  connectString: string;
  thick?: boolean;
  clientLibDir?: string;
  poolMax?: number;
}

export interface Config {
  connections: Record<string, ConnectionConfig>;
  schemaFilter: string[];
  readOnly: boolean;
  cacheDir: string;
}

export function loadConfig(): Config {
  let connections: Record<string, ConnectionConfig> = {};
  
  const projectJsonPath = resolve(process.cwd(), ".dba-master", "connections.json");
  const globalJsonPath = resolve(homedir(), ".dba-master", "connections.json");
  
  let usedPath = projectJsonPath;

  if (existsSync(projectJsonPath)) {
    try {
      const raw = readFileSync(projectJsonPath, "utf8");
      connections = JSON.parse(raw);
    } catch (e) {
      console.warn(`Aviso: falha ao ler ${projectJsonPath}`, e);
    }
  } else if (existsSync(globalJsonPath)) {
    usedPath = globalJsonPath;
    try {
      const raw = readFileSync(globalJsonPath, "utf8");
      connections = JSON.parse(raw);
    } catch (e) {
      console.warn(`Aviso: falha ao ler ${globalJsonPath}`, e);
    }
  }

  // Fallback para .env se connections.json não existir ou estiver vazio
  if (Object.keys(connections).length === 0) {
    const user = process.env.DB_USER;
    if (user) {
      connections["default"] = {
        engine: (process.env.DB_ENGINE || "oracle").toLowerCase(),
        user,
        password: process.env.DB_PASSWORD,
        connectString: process.env.DB_CONNECT_STRING || "",
        thick: process.env.DB_CLIENT_MODE?.toLowerCase() === "thick",
        clientLibDir: process.env.DB_CLIENT_LIB_DIR,
      };
    }
  }

  let defaultPoolMax = DEFAULT_POOL_MAX;
  if (process.env.DB_POOL_MAX) {
    const parsed = parseInt(process.env.DB_POOL_MAX, 10);
    if (!Number.isNaN(parsed)) {
      defaultPoolMax = parsed;
    }
  }

  for (const key of Object.keys(connections)) {
    if (connections[key].poolMax === undefined) {
      connections[key].poolMax = defaultPoolMax;
    }
  }

  if (Object.keys(connections).length === 0) {
    throw new Error("Nenhuma conexão configurada. Crie o connections.json ou configure o .env.");
  }

  return {
    connections,
    schemaFilter: (process.env.SCHEMA_FILTER || "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
    readOnly: process.env.READ_ONLY?.toLowerCase() !== "false",
    cacheDir: process.env.CACHE_DIR
      ? resolve(process.env.CACHE_DIR)
      : resolve(dirname(usedPath), "types"),
  };
}
