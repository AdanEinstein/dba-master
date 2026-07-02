import pg from "pg";
import { type ConnectionConfig, DEFAULT_POOL_MAX } from "../../config.js";
import { withTunnel, type Tunnel } from "../tunnel/index.js";

// Conexão específica do Postgres: pool node-postgres e execução de queries cruas.
// Binds POSICIONAIS ($1, $2, ...) — diferente do Oracle (nomeados :bind).

export class PgConnection {
  private pool: pg.Pool | undefined;
  private tunnel: Tunnel | null = null;

  constructor(private readonly cfg: ConnectionConfig) {}

  private async getPool(): Promise<pg.Pool> {
    if (this.pool) return this.pool;
    // Se houver bloco tunnel, abre o transporte (lazy) e reescreve o connectString
    // para a porta local do túnel; senão passthrough.
    const { connectString, tunnel } = await withTunnel(this.cfg);
    this.tunnel = tunnel;
    // connectString = URL completa (postgresql://user:pass@host:5432/db). user/password
    // continuam como fallback caso a URL não os traga.
    this.pool = new pg.Pool({
      connectionString: connectString,
      // Só passa user/password quando truthy — senão sobrescreveria as creds da URL.
      ...(this.cfg.user ? { user: this.cfg.user } : {}),
      ...(this.cfg.password ? { password: this.cfg.password } : {}),
      max: this.cfg.poolMax ?? DEFAULT_POOL_MAX,
    });
    return this.pool;
  }

  /** Executa uma query com params posicionais e devolve as linhas. */
  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const pool = await this.getPool();
    const r = await pool.query(sql, params as unknown[]);
    return r.rows as T[];
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = undefined;
    }
    await this.tunnel?.close();
    this.tunnel = null;
  }
}
