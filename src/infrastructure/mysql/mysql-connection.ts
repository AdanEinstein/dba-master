import mysql from "mysql2/promise";
import { type ConnectionConfig, DEFAULT_POOL_MAX } from "../../config.js";
import { withTunnel, type Tunnel } from "../tunnel/index.js";

// Conexão específica do MySQL: pool mysql2 e execução de queries cruas.

export class MysqlConnection {
  private pool: Promise<mysql.Pool> | undefined;
  private tunnel: Tunnel | null = null;

  constructor(private readonly cfg: ConnectionConfig) {}

  // Promise memoizada: chamadas simultâneas na 1ª vez compartilham UM pool/túnel.
  private getPool(): Promise<mysql.Pool> {
    return (this.pool ??= this.openPool().catch((e) => {
      this.pool = undefined;
      throw e;
    }));
  }

  private async openPool(): Promise<mysql.Pool> {

    // Se houver bloco tunnel, abre o transporte (lazy) e reescreve o connectString
    // para a porta local do túnel; senão passthrough.
    const { connectString, tunnel } = await withTunnel(this.cfg);
    this.tunnel = tunnel;

    const pool = mysql.createPool({
      uri: connectString,
      user: this.cfg.user || undefined, // Apenas passa se preenchido (se não, pega da URI)
      password: this.cfg.password || undefined,
      connectionLimit: this.cfg.poolMax ?? DEFAULT_POOL_MAX,
      dateStrings: true, // Garante que datas venham como string para parsing homogêneo depois
    });
    // Teto no servidor (SELECT): MySQL usa max_execution_time (ms), MariaDB max_statement_time (s).
    // ponytail: dispara os dois e ignora o erro do que o servidor não conhece — sem detectar versão.
    const ms = this.cfg.queryTimeoutMs;
    if (ms) {
      // mysql2/promise repassa o evento do pool core: `c` é a conexão de callback, não a promise.
      pool.on("connection", (c) => {
        const raw = c as unknown as { query(sql: string, cb: () => void): void };
        raw.query(`SET SESSION max_execution_time = ${ms}`, () => {});
        raw.query(`SET SESSION max_statement_time = ${ms / 1000}`, () => {});
      });
    }
    return pool;
  }

  /** Executa uma query e devolve as linhas como objetos tipados. */
  async query<T = Record<string, unknown>>(
    sql: string,
    values?: any,
  ): Promise<T[]> {
    const pool = await this.getPool();
    // timeout do driver: rede de segurança p/ o que o teto do servidor não cobre (DML, DDL).
    const timeout = this.cfg.queryTimeoutMs || undefined;
    const [rows] = await pool.query({ sql, values, timeout });
    return rows as T[];
  }

  async close(): Promise<void> {
    const pool = await this.pool?.catch(() => undefined);
    this.pool = undefined;
    await pool?.end();
    await this.tunnel?.close();
    this.tunnel = null;
  }
}
