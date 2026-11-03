import sql from "mssql";
import { type ConnectionConfig, DEFAULT_POOL_MAX } from "../../config.js";
import { withTunnel, type Tunnel } from "../tunnel/index.js";

// Conexão específica do SQL Server: pool `mssql` (tedious) e queries cruas.
// connectString = URL: sqlserver://user:senha@host:1433/db?encrypt=true&trustServerCertificate=true
// Binds nomeados @p1, @p2, ... (posicionais na API: params[0] → @p1).

/** Converte a URL em config do `mssql` (user/password decodificados; fallback para cfg). */
export function parseSqlServerUrl(connectString: string, cfg: Pick<ConnectionConfig, "user" | "password" | "poolMax">): sql.config {
  const u = new URL(connectString);
  const flag = (k: string, def: boolean) => {
    const v = u.searchParams.get(k);
    return v == null ? def : /^(true|yes|1)$/i.test(v);
  };
  return {
    server: u.hostname,
    port: u.port ? Number(u.port) : 1433,
    database: decodeURIComponent(u.pathname.replace(/^\//, "")) || undefined,
    user: u.username ? decodeURIComponent(u.username) : cfg.user || undefined,
    password: u.password ? decodeURIComponent(u.password) : cfg.password || undefined,
    pool: { max: cfg.poolMax ?? DEFAULT_POOL_MAX },
    options: {
      encrypt: flag("encrypt", true),
      trustServerCertificate: flag("trustServerCertificate", false),
      ...(u.searchParams.get("instanceName") ? { instanceName: u.searchParams.get("instanceName")! } : {}),
    },
  };
}

export class SqlServerConnection {
  private pool: sql.ConnectionPool | undefined;
  private connecting: Promise<sql.ConnectionPool> | undefined;
  private tunnel: Tunnel | null = null;

  constructor(private readonly cfg: ConnectionConfig) {}

  // Lazy e idempotente sob concorrência: chamadas simultâneas compartilham o mesmo connect.
  private getPool(): Promise<sql.ConnectionPool> {
    if (this.pool) return Promise.resolve(this.pool);
    this.connecting ??= (async () => {
      try {
        // Se houver bloco tunnel, abre o transporte (lazy) e reescreve o connectString
        // para a porta local do túnel; senão passthrough.
        const { connectString, tunnel } = await withTunnel(this.cfg);
        this.tunnel = tunnel;
        try {
          this.pool = await new sql.ConnectionPool(parseSqlServerUrl(connectString, this.cfg)).connect();
        } catch (e) {
          await this.tunnel?.close();
          this.tunnel = null;
          throw e;
        }
        return this.pool;
      } finally {
        this.connecting = undefined; // falha não "gruda": próxima chamada tenta de novo
      }
    })();
    return this.connecting;
  }

  /** Executa uma query com params posicionais (@p1..) e devolve as linhas do 1º recordset. */
  async query<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
    const pool = await this.getPool();
    const req = pool.request();
    params.forEach((v, i) => req.input(`p${i + 1}`, v));
    const r = await req.query(query);
    return (r.recordset ?? []) as T[];
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = undefined;
    }
    await this.tunnel?.close();
    this.tunnel = null;
  }
}
