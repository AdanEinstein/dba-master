import oracledb from "oracledb";
import type { ConnectionConfig } from "../../config.js";

// Conexão específica do Oracle: pool node-oracledb e execução de queries cruas.

export class OracleConnection {
  private pool: oracledb.Pool | undefined;

  constructor(private readonly cfg: ConnectionConfig) {}

  private async getPool(): Promise<oracledb.Pool> {
    if (this.pool) return this.pool;

    if (this.cfg.thick) {
      oracledb.initOracleClient(this.cfg.clientLibDir ? { libDir: this.cfg.clientLibDir } : {});
    }
    // Linhas como objetos {COLUNA: valor}; CLOB (usado pelo GET_DDL) vem como string.
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
    oracledb.fetchAsString = [oracledb.CLOB];

    this.pool = await oracledb.createPool({
      user: this.cfg.user,
      password: this.cfg.password,
      connectString: this.cfg.connectString,
      poolMin: 0,
      poolMax: 4,
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
  }
}
