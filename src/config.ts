import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Configuração lida do ambiente (.env). Falha cedo se faltar conexão. */
export interface Config {
  /** Engine de banco a usar. Default 'oracle'. */
  engine: string;
  user: string;
  password: string;
  connectString: string;
  /** thin (default, JS puro) ou thick (exige Oracle Instant Client). */
  thick: boolean;
  /** Diretório das libs do client Oracle quando em modo thick. */
  clientLibDir?: string;
  /** Lista de schemas a introspectar. Vazio = todos os acessíveis não-Oracle. */
  schemaFilter: string[];
  /** true = run_sql rejeita escrita (INSERT/UPDATE/DELETE/MERGE/DDL). Leitura sempre liberada. */
  readOnly: boolean;
  /** Onde as interfaces .ts do cache são gravadas. */
  cacheDir: string;
}

function req(names: string[]): string {
  for (const name of names) {
    const v = process.env[name];
    if (v) return v;
  }
  throw new Error(`Variável de ambiente obrigatória ausente: ${names[0]}`);
}

export function loadConfig(): Config {
  return {
    engine: (process.env.DB_ENGINE || "oracle").toLowerCase(),
    user: req(["DB_USER", "ORACLE_USER"]),
    password: req(["DB_PASSWORD", "ORACLE_PASSWORD"]),
    connectString: req(["DB_CONNECT_STRING", "ORACLE_CONNECT_STRING"]),
    thick: (process.env.DB_CLIENT_MODE || process.env.ORACLE_CLIENT_MODE)?.toLowerCase() === "thick",
    clientLibDir: process.env.DB_CLIENT_LIB_DIR || process.env.ORACLE_CLIENT_LIB_DIR || undefined,
    schemaFilter: (process.env.SCHEMA_FILTER || "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
    // Default seguro: só liberamos escrita se explicitamente READ_ONLY=false.
    readOnly: process.env.READ_ONLY?.toLowerCase() !== "false",
    cacheDir: process.env.CACHE_DIR
      ? resolve(process.env.CACHE_DIR)
      : resolve(__dirname, "..", ".cache"),
  };
}
