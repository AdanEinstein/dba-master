import net from "node:net";
import { SocksClient } from "socks";
import type { Endpoint, Tunnel } from "./index.js";

type ProxyConfig = Extract<import("../../config.js").TunnelConfig, { type: "socks" | "http" }>;

// Túnel via proxy: servidor TCP local que relaia cada conexão através de um proxy
// SOCKS5 (lib socks) ou HTTP CONNECT (à mão) até o destino real do banco.
export class ProxyTunnel implements Tunnel {
  private server: net.Server | undefined;
  private readonly proxy: URL;

  constructor(private readonly cfg: ProxyConfig) {
    this.proxy = new URL(cfg.url);
  }

  async open(dst: Endpoint): Promise<Endpoint> {
    const isSocks = this.cfg.type === "socks" || this.proxy.protocol.startsWith("socks");
    const server = net.createServer((sock) => {
      const relay = isSocks ? this.socksConnect(dst) : this.httpConnect(dst);
      relay
        .then((up) => {
          sock.pipe(up).pipe(sock);
          sock.on("error", () => up.destroy());
          up.on("error", () => sock.destroy());
        })
        .catch(() => sock.destroy());
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
    this.server = undefined;
  }

  private async socksConnect(dst: Endpoint): Promise<net.Socket> {
    const type = this.proxy.protocol.startsWith("socks4") ? 4 : 5;
    const { socket } = await SocksClient.createConnection({
      proxy: {
        host: this.proxy.hostname,
        port: Number(this.proxy.port) || 1080,
        type,
        userId: this.proxy.username || undefined,
        password: this.proxy.password || undefined,
      },
      command: "connect",
      destination: { host: dst.host, port: dst.port },
    });
    return socket;
  }

  private httpConnect(dst: Endpoint): Promise<net.Socket> {
    return new Promise((res, rej) => {
      const up = net.connect(Number(this.proxy.port) || 8080, this.proxy.hostname, () => {
        const auth = this.proxy.username
          ? `Proxy-Authorization: Basic ${Buffer.from(
              `${this.proxy.username}:${this.proxy.password}`,
            ).toString("base64")}\r\n`
          : "";
        up.write(
          `CONNECT ${dst.host}:${dst.port} HTTP/1.1\r\nHost: ${dst.host}:${dst.port}\r\n${auth}\r\n`,
        );
      });
      up.once("data", (chunk) => {
        if (/^HTTP\/1\.[01] 200/.test(chunk.toString("latin1"))) res(up);
        else {
          up.destroy();
          rej(new Error(`Proxy HTTP CONNECT falhou: ${chunk.toString("latin1").split("\r\n")[0]}`));
        }
      });
      up.on("error", rej);
    });
  }
}
