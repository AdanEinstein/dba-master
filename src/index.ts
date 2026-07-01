#!/usr/bin/env node
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
// Carrega o .env da raiz do projeto (relativo ao módulo), não do cwd do agente
// que sobe o server — assim funciona tanto em dist/ quanto em src/ (tsx).
// quiet: dotenv v17 imprime um banner no stdout — proibido no stream STDIO do MCP.
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env"), quiet: true });

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config.js";
import { createProvider } from "./infrastructure/provider-factory.js";
import { registerTools } from "./mcp/register.js";

// Subcomandos de instalação nos agentes (uso via npx, sem repo). Import dinâmico:
// não carrega fs/instalador no caminho do server MCP.
if (process.argv[2] === "install") {
  const { runInstaller } = await import("./install.js");
  await runInstaller();
  process.exit(0);
}

// Composition root: config → provider (adapter) → tools. Trocar de banco é só o DB_ENGINE.

const cfg = loadConfig();
const provider = createProvider(cfg);

serveStdio(() => {
  const server = new McpServer(
    { name: "dba-master", version: "__VERSION__" },
    { capabilities: { tools: {} } },
  );
  registerTools(server, provider, cfg);
  return server;
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await provider.close();
    process.exit(0);
  });
}
