import { type Config, type ConnectionConfig } from "../config.js";
import type { DatabaseProvider } from "../domain/database-provider.js";
import { OracleProvider } from "./oracle/oracle-provider.js";

// Gerencia múltiplas conexões
export class ProviderManager {
  private providers = new Map<string, DatabaseProvider>();

  constructor(private readonly cfg: Config) {
    for (const [name, connCfg] of Object.entries(cfg.connections)) {
      this.providers.set(name, this.createProvider(connCfg, cfg));
    }
  }

  private createProvider(connCfg: ConnectionConfig, globalCfg: Config): DatabaseProvider {
    switch (connCfg.engine) {
      case "oracle":
        return new OracleProvider(connCfg, globalCfg);
      default:
        throw new Error(`Engine de banco não suportado ainda: '${connCfg.engine}'. Suportados: oracle.`);
    }
  }

  public getProvider(name?: string): DatabaseProvider {
    if (!name) {
      // Se não passou nome e só tem uma conexão, usa ela.
      if (this.providers.size === 1) {
        return Array.from(this.providers.values())[0];
      }
      throw new Error("Múltiplas conexões disponíveis. Você deve especificar qual utilizar (connectionName).");
    }

    const provider = this.providers.get(name);
    if (!provider) {
      const names = Array.from(this.providers.keys()).join(", ");
      throw new Error(`Conexão '${name}' não encontrada. Disponíveis: ${names}`);
    }
    return provider;
  }

  public getAvailableConnections(): string[] {
    return Array.from(this.providers.keys());
  }

  public async closeAll(): Promise<void> {
    const closes = Array.from(this.providers.values()).map(p => p.close());
    await Promise.all(closes);
    this.providers.clear();
  }
}
