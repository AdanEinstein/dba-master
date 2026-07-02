import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import type { Endpoint, Tunnel } from "./index.js";

type CommandConfig = Extract<import("../../config.js").TunnelConfig, { type: "command" }>;

// Túnel lifecycle-only: um comando externo (cloud-sql-proxy, aws ssm, sshuttle...)
// abre o forward e escuta numa porta local. Só damos spawn, esperamos a porta
// responder e matamos no close. O destino é decidido pelo próprio comando.
export class CommandTunnel implements Tunnel {
  private child: ChildProcess | undefined;

  constructor(private readonly cfg: CommandConfig) {}

  async open(_dst: Endpoint): Promise<Endpoint> {
    const host = this.cfg.listenHost ?? "127.0.0.1";
    const port = this.cfg.listenPort;

    this.child = spawn(this.cfg.command, this.cfg.args ?? [], { stdio: "ignore" });
    this.child.on("error", (e) => {
      throw new Error(`Falha ao iniciar comando de túnel "${this.cfg.command}": ${e.message}`);
    });

    await waitForPort(host, port, 15000);
    return { host, port };
  }

  async close(): Promise<void> {
    this.child?.kill();
    this.child = undefined;
  }
}

// ponytail: poll simples até a porta aceitar conexão; timeout falha claro.
async function waitForPort(host: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ok = await new Promise<boolean>((res) => {
      const s = net
        .connect(port, host, () => {
          s.destroy();
          res(true);
        })
        .on("error", () => res(false));
    });
    if (ok) return;
    if (Date.now() > deadline) {
      throw new Error(`Túnel por comando: porta ${host}:${port} não abriu em ${timeoutMs}ms.`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}
