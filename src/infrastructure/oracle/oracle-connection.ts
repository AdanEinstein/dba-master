import oracledb from "oracledb";
import { type ConnectionConfig, DEFAULT_POOL_MAX } from "../../config.js";
import { withTunnel, type Tunnel } from "../tunnel/index.js";

// Conexão específica do Oracle: pool node-oracledb e execução de queries cruas.

export class OracleConnection {
  private pool: oracledb.Pool | undefined;
  private tunnel: Tunnel | null = null;

  constructor(private readonly cfg: ConnectionConfig) {}

  private async getPool(): Promise<oracledb.Pool> {
    if (this.pool) return this.pool;

    if (this.cfg.thick) {
      oracledb.initOracleClient(this.cfg.clientLibDir ? { libDir: this.cfg.clientLibDir } : {});
    }
    // Linhas como objetos {COLUNA: valor}; CLOB (usado pelo GET_DDL) vem como string.
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
    oracledb.fetchAsString = [oracledb.CLOB];

    // Se houver bloco tunnel, abre o transporte (lazy) e reescreve o connectString
    // para a porta local do túnel; senão passthrough.
    const { connectString, tunnel } = await withTunnel(this.cfg);
    this.tunnel = tunnel;

    this.pool = await oracledb.createPool({
      user: this.cfg.user,
      password: this.cfg.password,
      connectString,
      poolMin: 0,
      poolMax: this.cfg.poolMax ?? DEFAULT_POOL_MAX,
    });
    return this.pool;
  }

  /** Executa uma query e devolve as linhas como objetos tipados. */
  async query<T = Record<string, unknown>>(
    sql: string,
    binds: Record<string, unknown> = {},
    opts: oracledb.ExecuteOptions = {},
  ): Promise<T[]> {
    const pool = await this.getPool();
    const conn = await pool.getConnection();
    try {
      const r = await conn.execute<T>(sql, binds as oracledb.BindParameters, { ...opts });
      return r.rows ?? [];
    } finally {
      await conn.close();
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.close(5);
      this.pool = undefined;
    }
    await this.tunnel?.close();
    this.tunnel = null;
  }
}
