import { type Config, type ConnectionConfig } from "../config.js";
import type { DatabaseProvider } from "../domain/database-provider.js";
import { OracleProvider } from "./oracle/oracle-provider.js";

// Gerencia múltiplas conexões
export class ProviderManager {
  private providers = new Map<string, DatabaseProvider>();

  constructor(cfg: Config) {
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
    return this.providers.get(this.resolveConnectionName(name))!;
  }

  public resolveConnectionName(name?: string): string {
    if (this.providers.size === 0) {
      throw new Error("Nenhuma conexão configurada. Rode `npx -y dba-master configure` para criar o connections.json.");
    }
    if (!name) {
      if (this.providers.size === 1) {
        return Array.from(this.providers.keys())[0];
      }
      throw new Error("Múltiplas conexões disponíveis. Você deve especificar qual utilizar (connectionName).");
    }
    if (!this.providers.has(name)) {
      const names = Array.from(this.providers.keys()).join(", ");
      throw new Error(`Conexão '${name}' não encontrada. Disponíveis: ${names}`);
    }
    return name;
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
