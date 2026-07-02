import { type ConnectionConfig, type TunnelConfig } from "../../config.js";
import { SshTunnel } from "./ssh-tunnel.js";
import { ProxyTunnel } from "./proxy-tunnel.js";
import { CommandTunnel } from "./command-tunnel.js";

// Camada de transporte: quando o banco só é acessível via bastion/proxy, abre um
// túnel e devolve um endpoint LOCAL onde o driver deve discar. Um túnel por
// conexão (ver YAGNI no design). Segredos vêm já interpolados do config.

export interface Endpoint {
  host: string;
  port: number;
}

export interface Tunnel {
  /** Abre o transporte e devolve o endpoint local a discar. */
  open(dst: Endpoint): Promise<Endpoint>;
  close(): Promise<void>;
}

function createTunnel(cfg: TunnelConfig): Tunnel {
  switch (cfg.type) {
    case "ssh":
      return new SshTunnel(cfg);
    case "socks":
    case "http":
      return new ProxyTunnel(cfg);
    case "command":
      return new CommandTunnel(cfg);
  }
}

// Extrai host:port do connectString. Postgres = URL; Oracle = EZConnect host:port/service.
export function parseEndpoint(engine: string, connectString: string): Endpoint {
  if (engine === "oracle") {
    // EZConnect: [//]host[:port][/service]. TNS descriptor completo fora de escopo.
    const m = connectString.replace(/^\/\//, "").match(/^([^:/]+)(?::(\d+))?/);
    if (!m) throw new Error(`connectString Oracle não reconhecido para túnel: ${connectString}`);
    return { host: m[1], port: m[2] ? Number(m[2]) : 1521 };
  }
  // Postgres: postgresql://user:pass@host:port/db
  const u = new URL(connectString);
  return { host: u.hostname, port: u.port ? Number(u.port) : 5432 };
}

// Reescreve o connectString para apontar ao endpoint local do túnel.
export function rewriteConnectString(
  engine: string,
  connectString: string,
  local: Endpoint,
): string {
  if (engine === "oracle") {
    const dst = parseEndpoint(engine, connectString);
    // Sempre emite host:localport (mesmo se o original não tinha porta) — senão o
    // driver discaria 1521 local em vez da porta do túnel.
    const esc = dst.host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return connectString.replace(
      new RegExp(`(^|//)${esc}(?::\\d+)?`),
      `$1${local.host}:${local.port}`,
    );
  }
  const u = new URL(connectString);
  u.hostname = local.host;
  u.port = String(local.port);
  return u.toString();
}

// Se a conexão tem túnel: abre, reescreve o connectString e devolve o handle p/
// fechar. Sem túnel: passthrough. Chamado (lazy) dentro do getPool das connections.
export async function withTunnel(
  cfg: ConnectionConfig,
): Promise<{ connectString: string; tunnel: Tunnel | null }> {
  if (!cfg.tunnel) return { connectString: cfg.connectString, tunnel: null };

  const tunnel = createTunnel(cfg.tunnel);
  const dst = parseEndpoint(cfg.engine, cfg.connectString);
  const local = await tunnel.open(dst);
  return {
    connectString: rewriteConnectString(cfg.engine, cfg.connectString, local),
    tunnel,
  };
}
