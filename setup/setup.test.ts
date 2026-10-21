import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConfigure, runInstaller, runUninstaller } from "./index.js";
import { claudeDesktopConfigPath } from "./install-mcp.js";

// Modo rápido ponta a ponta num tmpdir; HOME/SHELL apontam pro tmp p/ não tocar no rc real.
test("install/configure/uninstall rápidos, escopo projeto", { skip: process.platform === "win32" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "dba-fast-"));
  const prev = { cwd: process.cwd(), HOME: process.env.HOME, SHELL: process.env.SHELL };
  process.chdir(dir);
  process.env.HOME = dir;
  process.env.SHELL = "/bin/bash";
  try {
    await runInstaller(["--agents", "claude"]);
    const mcp = JSON.parse(fs.readFileSync(join(dir, ".mcp.json"), "utf8"));
    assert.ok(mcp.mcpServers["dba-master"]);

    await runConfigure(["--name", "t", "--engine", "postgres", "--connect-string", "postgresql://u:p@h/db", "--env-ref"]);
    const conns = JSON.parse(fs.readFileSync(join(dir, ".dba-master", "connections.json"), "utf8"));
    assert.equal(conns.t.engine, "postgres");
    assert.equal(conns.t.connectString, "${DBA_T_CS}");
    assert.equal(conns.t.readOnly, true);
    assert.match(fs.readFileSync(join(dir, ".bashrc"), "utf8"), /^export DBA_T_CS='postgresql:\/\/u:p@h\/db' # dba-master:t$/m);

    await assert.rejects(runConfigure(["--name", "x", "--engine", "foo", "--connect-string", "y"]), /--engine inválido/);
    await assert.rejects(runInstaller(["--agents", "nope"]), /inválido/);

    await runUninstaller(["--agents", "claude", "--purge"]);
    assert.equal(fs.existsSync(join(dir, ".dba-master")), false);
    assert.doesNotMatch(fs.readFileSync(join(dir, ".bashrc"), "utf8"), /DBA_T_CS/);
  } finally {
    process.chdir(prev.cwd);
    process.env.HOME = prev.HOME;
    process.env.SHELL = prev.SHELL;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("claude -g grava Claude Desktop no path da plataforma e Code em ~/.claude.json", { skip: process.platform === "win32" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "dba-desktop-"));
  const prev = { cwd: process.cwd(), HOME: process.env.HOME, SHELL: process.env.SHELL };
  process.chdir(dir);
  process.env.HOME = dir;
  process.env.SHELL = "/bin/bash";
  try {
    const desktop = claudeDesktopConfigPath();
    const legacy = join(dir, ".claude", "claude_desktop_config.json");
    assert.ok(desktop.startsWith(dir) && desktop !== legacy);
    fs.mkdirSync(join(desktop, ".."), { recursive: true });
    fs.writeFileSync(desktop, JSON.stringify({ outra: 1, mcpServers: { x: { command: "y" } } }));
    fs.mkdirSync(join(dir, ".claude"), { recursive: true });
    fs.writeFileSync(legacy, JSON.stringify({ mcpServers: { "dba-master": {} } }));

    await runInstaller(["--agents", "claude", "-g"]);
    const d = JSON.parse(fs.readFileSync(desktop, "utf8"));
    assert.equal(d.outra, 1);
    assert.deepEqual(d.mcpServers.x, { command: "y" });
    assert.equal(d.mcpServers["dba-master"].command, "npx");
    assert.equal("type" in d.mcpServers["dba-master"], false);
    assert.ok(JSON.parse(fs.readFileSync(join(dir, ".claude.json"), "utf8")).mcpServers["dba-master"]);

    await runUninstaller(["--agents", "claude", "-g"]);
    assert.equal(JSON.parse(fs.readFileSync(desktop, "utf8")).mcpServers["dba-master"], undefined);
    assert.ok(JSON.parse(fs.readFileSync(desktop, "utf8")).mcpServers.x);
    assert.equal(JSON.parse(fs.readFileSync(legacy, "utf8")).mcpServers["dba-master"], undefined);
  } finally {
    process.chdir(prev.cwd);
    process.env.HOME = prev.HOME;
    process.env.SHELL = prev.SHELL;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("maskSecret esconde a senha embutida na URL", async () => {
  const { maskSecret } = await import("./index.js");
  assert.equal(maskSecret("postgresql://u:s3nh@@h:5432/db"), "postgresql://u:***@h:5432/db");
  assert.equal(maskSecret("localhost:1521/ORCL"), "localhost:1521/ORCL");
  assert.equal(maskSecret("${DBA_X_CS}"), "${DBA_X_CS}");
});
