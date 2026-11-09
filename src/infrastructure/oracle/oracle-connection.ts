import oracledb from "oracledb";
import { type ConnectionConfig, DEFAULT_POOL_MAX } from "../../config.js";
import { withTunnel, type Tunnel } from "../tunnel/index.js";

// Conexão específica do Oracle: pool node-oracledb e execução de queries cruas.

export class OracleConnection {
  private pool: Promise<oracledb.Pool> | undefined;
  private tunnel: Tunnel | null = null;

  constructor(private readonly cfg: ConnectionConfig) {}

  // Promise memoizada: chamadas simultâneas na 1ª vez (Promise.all, generate com N workers)
  // compartilham UM pool/túnel. Falha não "gruda": a próxima chamada tenta de novo.
  private getPool(): Promise<oracledb.Pool> {
    return (this.pool ??= this.openPool().catch((e) => {
      this.pool = undefined;
      throw e;
    }));
  }

  private async openPool(): Promise<oracledb.Pool> {
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
    try {
      return await oracledb.createPool({
        user: this.cfg.user,
        password: this.cfg.password,
        connectString,
        poolMin: 0,
        poolMax: this.cfg.poolMax ?? DEFAULT_POOL_MAX,
      });
    } catch (e) {
      await this.tunnel?.close();
      this.tunnel = null;
      throw e;
    }
  }

  /** Executa uma query e devolve as linhas como objetos tipados. */
  async query<T = Record<string, unknown>>(
    sql: string,
    binds: Record<string, unknown> = {},
    opts: oracledb.ExecuteOptions = {},
  ): Promise<T[]> {
    const pool = await this.getPool();
    const conn = await pool.getConnection();
    // Teto por round-trip: estourou → o driver interrompe a chamada no servidor (break).
    if (this.cfg.queryTimeoutMs) conn.callTimeout = this.cfg.queryTimeoutMs;
    try {
      const r = await conn.execute<T>(sql, binds as oracledb.BindParameters, { ...opts });
      return r.rows ?? [];
    } finally {
      await conn.close();
    }
  }

  /**
   * Várias execuções numa sessão só: ALTER SESSION (CURRENT_SCHEMA etc.) vale p/ as seguintes.
   * autoCommit: DML de script de deploy persiste (query() devolve a conexão ao pool sem commit).
   * ponytail: sem callTimeout — script de deploy (CREATE INDEX etc.) pode passar do teto legítimo.
   */
  async session<T>(fn: (exec: <R>(sql: string) => Promise<R[]>) => Promise<T>): Promise<T> {
    const conn = await (await this.getPool()).getConnection();
    try {
      return await fn(async <R>(sql: string) => (await conn.execute<R>(sql, [], { autoCommit: true })).rows ?? []);
    } finally {
      await conn.close();
    }
  }

  async close(): Promise<void> {
    const pool = await this.pool?.catch(() => undefined);
    this.pool = undefined;
    await pool?.close(5);
    await this.tunnel?.close();
    this.tunnel = null;
  }
}
