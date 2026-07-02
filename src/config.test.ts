import { test, describe, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, DEFAULT_POOL_MAX } from "./config.js";

// loadConfig lê ./.dba-master/connections.json (cwd) ou ~/.dba-master/connections.json.
// Isolamos ambos via cwd temporário + HOME temporário (os.homedir() usa $HOME no POSIX),
// exercitando o fs real em vez de mockar imports nomeados de node:fs (que não interceptam).
function sandbox(connections?: unknown): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dba-cfg-"));
  process.chdir(dir);
  process.env.HOME = dir;
  if (connections !== undefined) {
    fs.mkdirSync(path.join(dir, ".dba-master"));
    fs.writeFileSync(path.join(dir, ".dba-master", "connections.json"), JSON.stringify(connections));
  }
}

describe("loadConfig — connections.json como fonte única", () => {
  const origCwd = process.cwd();
  const origHome = process.env.HOME;

  afterEach(() => {
    process.chdir(origCwd);
    process.env.HOME = origHome;
  });

  test("sem connections.json não lança e retorna zero conexões (evita -32000 no boot)", () => {
    sandbox();
    const config = loadConfig();
    assert.deepStrictEqual(config.connections, {});
    assert.strictEqual(typeof config.cacheDir, "string");
  });

  test("aplica defaults por conexão (poolMax, readOnly, schemaFilter)", () => {
    sandbox({ dev: { engine: "oracle", user: "u", connectString: "host/svc" } });
    const { connections } = loadConfig();
    assert.strictEqual(connections.dev.poolMax, DEFAULT_POOL_MAX);
    assert.strictEqual(connections.dev.readOnly, true);
    assert.deepStrictEqual(connections.dev.schemaFilter, []);
  });

  test("preserva settings explícitos do connections.json", () => {
    sandbox({
      prod: {
        engine: "oracle", user: "u", connectString: "host/svc",
        poolMax: 20, readOnly: false, schemaFilter: ["APP"],
      },
    });
    const { connections } = loadConfig();
    assert.strictEqual(connections.prod.poolMax, 20);
    assert.strictEqual(connections.prod.readOnly, false);
    assert.deepStrictEqual(connections.prod.schemaFilter, ["APP"]);
  });

  test("interpola ${VAR} nos campos sensíveis a partir de process.env", () => {
    process.env.DBA_TEST_PASS = "s3cr3t";
    process.env.DBA_TEST_CS = "host:1521/svc";
    sandbox({
      dev: { engine: "oracle", user: "u", password: "${DBA_TEST_PASS}", connectString: "${DBA_TEST_CS}" },
    });
    const { connections } = loadConfig();
    assert.strictEqual(connections.dev.password, "s3cr3t");
    assert.strictEqual(connections.dev.connectString, "host:1521/svc");
    delete process.env.DBA_TEST_PASS;
    delete process.env.DBA_TEST_CS;
  });

  test("env var referenciada e ausente lança erro nomeando a var", () => {
    delete process.env.DBA_MISSING;
    sandbox({
      dev: { engine: "oracle", user: "u", password: "${DBA_MISSING}", connectString: "host/svc" },
    });
    assert.throws(() => loadConfig(), /DBA_MISSING/);
  });
});
