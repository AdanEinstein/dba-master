#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config.js";
import { createProvider } from "./infrastructure/provider-factory.js";
import { registerTools } from "./mcp/register.js";

// Composition root: config → provider (adapter) → tools. Trocar de banco é só o DB_ENGINE.

const cfg = loadConfig();
const provider = createProvider(cfg);

serveStdio(() => {
  const server = new McpServer(
    { name: "dba-master", version: "1.0.0" },
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
