#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config.js";
import { ProviderManager } from "./infrastructure/provider-manager.js";
import { registerTools } from "./mcp/register.js";

// Subcomandos de instalação nos agentes (uso via npx, sem repo). Import dinâmico:
// não carrega fs/instalador no caminho do server MCP. Com flags → modo rápido; erro de flag → exit 1.
const fail = (e: unknown) => {
  console.error(`Erro: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
};

if (process.argv[2] === "install") {
  const { runInstaller } = await import("../setup/index.js");
  await runInstaller(process.argv.slice(3)).catch(fail);
  process.exit(0);
}

if (process.argv[2] === "uninstall") {
  const { runUninstaller } = await import("../setup/index.js");
  await runUninstaller(process.argv.slice(3)).catch(fail);
  process.exit(0);
}

if (process.argv[2] === "configure") {
  const { runConfigure } = await import("../setup/index.js");
  await runConfigure(process.argv.slice(3)).catch(fail);
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
                 --agents <a,b,...|all>  Agentes: claude, copilot, opencode, antigravity, cursor (pula o prompt)
                 -g, --global            Escopo global (~/.dba-master). Padrão: projeto
  uninstall    Remove o MCP Server dos agentes de IA.
                 --agents <a,b,...|all>  Agentes a limpar (pula o prompt)
                 -g, --global            Escopo global
                 --purge                 Apaga também o .dba-master e as env vars das conexões
  configure    Gerencia as credenciais e configurações de banco de dados (connections.json).
               Com flags, cria/atualiza uma conexão sem prompts:
                 --name <nome>           Nome da conexão
                 --engine <e>            oracle | postgres | mysql
                 --connect-string <cs>   String/URL de conexão (postgres/mysql: credenciais na URL)
                 --user <u>              (Oracle) Usuário
                 --password <p>          (Oracle) Senha
                 --thick                 (Oracle) Thick mode
                 --client-lib-dir <dir>  (Oracle) Caminho do Instant Client (implica --thick)
                 --writable              Libera escrita (padrão: read-only)
                 --env-ref               Guarda credenciais como \${DBA_<CONN>_*} e grava no rc do shell
                 -g, --global            Escopo global
  generate     Compila as interfaces TypeScript do schema do banco de dados (standalone).
                 --schema <a,b,...>   (Opcional) Schema(s), separados por vírgula. Sem isso, prompt interativo.
                 --connection <nome>  (Opcional) Conexão a ser usada
                 --no-views           (Opcional) Ignora a compilação de views
                 --force              (Opcional) Força a recompilação
  help         Mostra esta mensagem de ajuda.

Exemplos (modo rápido):
  npx -y dba-master@latest install --agents claude,cursor -g
  npx -y dba-master@latest configure --name prod --engine postgres --connect-string 'postgresql://u:p@h:5432/db' --env-ref -g
  npx -y dba-master@latest uninstall --agents all -g --purge

Aviso: senha em flag fica no histórico do shell — prefira --env-ref (e limpe o histórico) ou a TUI.

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
