#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config.js";
import { ProviderManager } from "./infrastructure/provider-manager.js";
import { registerTools } from "./mcp/register.js";

// Subcomandos de instalação nos agentes (uso via npx, sem repo). Import dinâmico:
// não carrega fs/instalador no caminho do server MCP.
if (process.argv[2] === "install") {
  const { runInstaller } = await import("../setup/index.js");
  await runInstaller();
  process.exit(0);
}

if (process.argv[2] === "uninstall") {
  const { runUninstaller } = await import("../setup/index.js");
  await runUninstaller();
  process.exit(0);
}

if (process.argv[2] === "configure") {
  const { runConfigure } = await import("../setup/index.js");
  await runConfigure();
  process.exit(0);
}

if (process.argv[2] === "generate") {
  const { runGenerate } = await import("../generator/index.js");
  await runGenerate(process.argv.slice(3));
  process.exit(0);
}

if (process.argv[2] === "help" || process.argv[2] === "--help" || process.argv[2] === "-h") {
  console.log(`
Uso: npx -y dba-master@latest [comando]

Comandos disponíveis:
  install      Instala e configura o MCP Server nos agentes de IA.
  uninstall    Remove o MCP Server dos agentes de IA.
  configure    Gerencia as credenciais e configurações de banco de dados (connections.json).
  generate     Compila as interfaces TypeScript do schema do banco de dados (standalone).
                 --schema <a,b,...>   (Opcional) Schema(s), separados por vírgula. Sem isso, prompt interativo.
                 --connection <nome>  (Opcional) Conexão a ser usada
                 --no-views           (Opcional) Ignora a compilação de views
                 --force              (Opcional) Força a recompilação
  help         Mostra esta mensagem de ajuda.

Se nenhum comando for passado, o processo iniciará o MCP Server em stdio (para consumo pelos agentes).
`);
  process.exit(0);
}

// Composition root: config → provider (adapter) → tools. Trocar de banco é só o DB_ENGINE.

const cfg = loadConfig();
const providerManager = new ProviderManager(cfg);

serveStdio(() => {
  const server = new McpServer(
    { name: "dba-master", version: "__VERSION__" },
    { capabilities: { tools: {} } },
  );
  registerTools(server, providerManager, cfg);
  return server;
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await providerManager.closeAll();
    process.exit(0);
  });
}
