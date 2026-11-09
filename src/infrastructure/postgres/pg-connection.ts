import pg from "pg";
import { type ConnectionConfig, DEFAULT_POOL_MAX } from "../../config.js";
import { withTunnel, type Tunnel } from "../tunnel/index.js";

// Conexão específica do Postgres: pool node-postgres e execução de queries cruas.
// Binds POSICIONAIS ($1, $2, ...) — diferente do Oracle (nomeados :bind).

export class PgConnection {
  private pool: Promise<pg.Pool> | undefined;
  private tunnel: Tunnel | null = null;

  constructor(private readonly cfg: ConnectionConfig) {}

  // Promise memoizada: chamadas simultâneas na 1ª vez compartilham UM pool/túnel.
  private getPool(): Promise<pg.Pool> {
    return (this.pool ??= this.openPool().catch((e) => {
      this.pool = undefined;
      throw e;
    }));
  }

  private async openPool(): Promise<pg.Pool> {
    // Se houver bloco tunnel, abre o transporte (lazy) e reescreve o connectString
    // para a porta local do túnel; senão passthrough.
    const { connectString, tunnel } = await withTunnel(this.cfg);
    this.tunnel = tunnel;
    // connectString = URL completa (postgresql://user:pass@host:5432/db). user/password
    // continuam como fallback caso a URL não os traga.
    return new pg.Pool({
      connectionString: connectString,
      // Só passa user/password quando truthy — senão sobrescreveria as creds da URL.
      ...(this.cfg.user ? { user: this.cfg.user } : {}),
      ...(this.cfg.password ? { password: this.cfg.password } : {}),
      max: this.cfg.poolMax ?? DEFAULT_POOL_MAX,
      // Teto no servidor: o Postgres cancela a query (libera CPU no banco, não só no Node).
      ...(this.cfg.queryTimeoutMs ? { statement_timeout: this.cfg.queryTimeoutMs } : {}),
    });
  }

  /** Executa uma query com params posicionais e devolve as linhas. */
  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const pool = await this.getPool();
    const r = await pool.query(sql, params as unknown[]);
    return r.rows as T[];
  }

  async close(): Promise<void> {
    const pool = await this.pool?.catch(() => undefined);
    this.pool = undefined;
    await pool?.end();
    await this.tunnel?.close();
    this.tunnel = null;
  }
}
