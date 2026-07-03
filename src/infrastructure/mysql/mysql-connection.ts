import mysql from "mysql2/promise";
import { type ConnectionConfig, DEFAULT_POOL_MAX } from "../../config.js";
import { withTunnel, type Tunnel } from "../tunnel/index.js";

// Conexão específica do MySQL: pool mysql2 e execução de queries cruas.

export class MysqlConnection {
  private pool: mysql.Pool | undefined;
  private tunnel: Tunnel | null = null;

  constructor(private readonly cfg: ConnectionConfig) {}

  private async getPool(): Promise<mysql.Pool> {
    if (this.pool) return this.pool;

    // Se houver bloco tunnel, abre o transporte (lazy) e reescreve o connectString
    // para a porta local do túnel; senão passthrough.
    const { connectString, tunnel } = await withTunnel(this.cfg);
    this.tunnel = tunnel;

    this.pool = mysql.createPool({
      uri: connectString,
      user: this.cfg.user || undefined, // Apenas passa se preenchido (se não, pega da URI)
      password: this.cfg.password || undefined,
      connectionLimit: this.cfg.poolMax ?? DEFAULT_POOL_MAX,
      dateStrings: true, // Garante que datas venham como string para parsing homogêneo depois
    });
    return this.pool;
  }

  /** Executa uma query e devolve as linhas como objetos tipados. */
  async query<T = Record<string, unknown>>(
    sql: string,
    values?: any,
  ): Promise<T[]> {
    const pool = await this.getPool();
    const [rows] = await pool.query(sql, values);
    return rows as T[];
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
