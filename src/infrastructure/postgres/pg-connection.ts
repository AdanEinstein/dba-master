import pg from "pg";
import { type ConnectionConfig, DEFAULT_POOL_MAX } from "../../config.js";

// Conexão específica do Postgres: pool node-postgres e execução de queries cruas.
// Binds POSICIONAIS ($1, $2, ...) — diferente do Oracle (nomeados :bind).

export class PgConnection {
  private pool: pg.Pool | undefined;

  constructor(private readonly cfg: ConnectionConfig) {}

  private getPool(): pg.Pool {
    if (this.pool) return this.pool;
    // connectString = URL completa (postgresql://user:pass@host:5432/db). user/password
    // continuam como fallback caso a URL não os traga.
    this.pool = new pg.Pool({
      connectionString: this.cfg.connectString,
      // Só passa user/password quando truthy — senão sobrescreveria as creds da URL.
      ...(this.cfg.user ? { user: this.cfg.user } : {}),
      ...(this.cfg.password ? { password: this.cfg.password } : {}),
      max: this.cfg.poolMax ?? DEFAULT_POOL_MAX,
    });
    return this.pool;
  }

  /** Executa uma query com params posicionais e devolve as linhas. */
  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const pool = this.getPool();
    const r = await pool.query(sql, params as unknown[]);
    return r.rows as T[];
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = undefined;
    }
  }
}
