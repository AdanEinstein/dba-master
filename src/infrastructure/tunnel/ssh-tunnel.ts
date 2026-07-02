import net from "node:net";
import { createHash, createHmac } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "ssh2";
import type { Endpoint, Tunnel } from "./index.js";

type SshConfig = Extract<import("../../config.js").TunnelConfig, { type: "ssh" }>;

// Túnel SSH in-process (ssh2, puro JS, cross-platform). Cria um servidor TCP local
// efêmero; cada conexão vira um forwardOut(dst) pelo bastion. Host key verificado
// por known_hosts (default) ou pin de fingerprint.
export class SshTunnel implements Tunnel {
  private client: Client | undefined;
  private server: net.Server | undefined;

  constructor(private readonly cfg: SshConfig) {}

  async open(dst: Endpoint): Promise<Endpoint> {
    const client = new Client();
    this.client = client;

    await new Promise<void>((res, rej) => {
      client.on("ready", res).on("error", rej).connect({
        host: this.cfg.host,
        port: this.cfg.port ?? 22,
        username: this.cfg.user,
        password: this.cfg.password,
        privateKey: readKey(this.cfg.privateKey),
        passphrase: this.cfg.passphrase,
        agent: this.cfg.agent ? process.env.SSH_AUTH_SOCK : undefined,
        hostVerifier: makeHostVerifier(this.cfg),
      });
    });

    const server = net.createServer((sock) => {
      client.forwardOut("127.0.0.1", 0, dst.host, dst.port, (err, stream) => {
        if (err) {
          sock.destroy();
          return;
        }
        sock.pipe(stream).pipe(sock);
      });
    });
    this.server = server;

    const port: number = await new Promise((res, rej) => {
      server.on("error", rej).listen(0, "127.0.0.1", () => {
        res((server.address() as net.AddressInfo).port);
      });
    });

    return { host: "127.0.0.1", port };
  }

  async close(): Promise<void> {
    await new Promise<void>((res) => (this.server ? this.server.close(() => res()) : res()));
    this.client?.end();
    this.server = undefined;
    this.client = undefined;
  }
}

function readKey(privateKey?: string): Buffer | undefined {
  if (!privateKey) return undefined;
  // Aceita path de arquivo OU conteúdo PEM direto.
  if (privateKey.includes("BEGIN") && privateKey.includes("PRIVATE KEY")) {
    return Buffer.from(privateKey);
  }
  return readFileSync(privateKey);
}

// hostVerifier do ssh2: recebe a chave pública do servidor (Buffer). Pin de
// fingerprint tem prioridade; senão valida contra known_hosts. Falha fechado.
function makeHostVerifier(cfg: SshConfig): (key: Buffer) => boolean {
  if (cfg.hostKey) {
    const want = cfg.hostKey.replace(/^SHA256:/, "").replace(/=+$/, "");
    return (key) => sha256Fp(key) === want;
  }

  const path = cfg.knownHosts ?? join(homedir(), ".ssh", "known_hosts");
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  const host = cfg.host;
  const port = cfg.port ?? 22;

  return (key) => {
    const b64 = key.toString("base64");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [pattern, , k] = trimmed.split(/\s+/);
      if (k !== b64) continue;
      if (hostMatches(pattern, host, port)) return true;
    }
    return false;
  };
}

function sha256Fp(key: Buffer): string {
  return createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
}

// Compara host:port contra um padrão de known_hosts (lista por vírgula, entradas
// [host]:port para porta != 22, e hostnames hasheados |1|salt|hash).
function hostMatches(pattern: string, host: string, port: number): boolean {
  const target = port === 22 ? host : `[${host}]:${port}`;
  for (const raw of pattern.split(",")) {
    const p = raw.trim();
    if (p.startsWith("|1|")) {
      const [, salt, hash] = p.split("|");
      const h = createHmac("sha1", Buffer.from(salt, "base64")).update(target).digest("base64");
      if (h === hash) return true;
      // porta 22 também pode estar hasheada como o host puro (já coberto por target)
    } else if (p === target) {
      return true;
    }
  }
  return false;
}
