import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Regressão do Node órfão: cliente MCP fecha o stdin (sem sinal) com uma query presa no banco.
// O "banco" é um socket que aceita e nunca responde — a query do pg fica pendurada para sempre.
// Antes: o socket aberto segurava o processo vivo indefinidamente. Agora: sai em até ~5s.
test("servidor encerra quando o stdin fecha, mesmo com query presa", { timeout: 20_000 }, async () => {
  const sockets: net.Socket[] = [];
  let connected!: () => void;
  const gotConnection = new Promise<void>((r) => (connected = r));
  const fakeDb = net.createServer((s) => (sockets.push(s), connected()));
  await new Promise<void>((r) => fakeDb.listen(0, "127.0.0.1", r));
  const port = (fakeDb.address() as net.AddressInfo).port;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dba-shutdown-"));
  fs.mkdirSync(path.join(dir, ".dba-master"));
  fs.writeFileSync(
    path.join(dir, ".dba-master", "connections.json"),
    JSON.stringify({ db: { engine: "postgres", connectString: `postgresql://u:p@127.0.0.1:${port}/x` } }),
  );

  const entry = fileURLToPath(new URL("./index.ts", import.meta.url));
  // tsx resolvido daqui: o cwd do filho é o dir temporário (sem node_modules).
  const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), entry], { cwd: dir, env: { ...process.env, HOME: dir } });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const exited = new Promise<number | null>((r) => child.on("exit", (code) => r(code)));
  const send = (m: object) => child.stdin.write(JSON.stringify(m) + "\n");

  try {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "run_sql", arguments: { sql: "SELECT 1" } } });
    // query em voo, pendurada no "banco". Filho morreu antes → falha com o stderr.
    const died = exited.then((c) => assert.fail(`servidor saiu cedo (${c}): ${stderr}`));
    died.catch(() => {}); // saída normal depois do race não vira unhandled rejection
    await Promise.race([gotConnection, died]);

    child.stdin.end();
    const t0 = Date.now();
    const timedOut = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 10_000).unref());
    assert.notEqual(await Promise.race([exited, timedOut]), "timeout", "processo continuou vivo após o stdin fechar");
    assert.ok(Date.now() - t0 < 10_000);
  } finally {
    child.kill("SIGKILL");
    sockets.forEach((s) => s.destroy());
    fakeDb.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
