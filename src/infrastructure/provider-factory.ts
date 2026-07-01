import { loadConfig, type Config } from "../config.js";
import type { DatabaseProvider } from "../domain/database-provider.js";
import { OracleProvider } from "./oracle/oracle-provider.js";

// Composição: escolhe o adapter conforme o engine configurado.
// Novo banco = novo case aqui + um adapter que implemente DatabaseProvider.

export function createProvider(cfg: Config = loadConfig()): DatabaseProvider {
  switch (cfg.engine) {
    case "oracle":
      return new OracleProvider(cfg);
    default:
      throw new Error(`Engine de banco não suportado ainda: '${cfg.engine}'. Suportados: oracle.`);
  }
}
