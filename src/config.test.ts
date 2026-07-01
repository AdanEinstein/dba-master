import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { loadConfig, DEFAULT_POOL_MAX } from "./config.js";

describe("Config DB_POOL_MAX parsing", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mock.method(fs, 'existsSync', () => false);
  });

  afterEach(() => {
    process.env = originalEnv;
    mock.restoreAll();
  });

  test("uses default value when DB_POOL_MAX is absent", () => {
    delete process.env.DB_POOL_MAX;
    process.env.DB_USER = "test"; // To ensure fallback config is created
    
    const config = loadConfig();
    const firstKey = Object.keys(config.connections)[0];
    assert.strictEqual(config.connections[firstKey].poolMax, DEFAULT_POOL_MAX);
  });

  test("parses valid numeric DB_POOL_MAX", () => {
    process.env.DB_POOL_MAX = "12";
    process.env.DB_USER = "test";
    
    const config = loadConfig();
    const firstKey = Object.keys(config.connections)[0];
    assert.strictEqual(config.connections[firstKey].poolMax, 12);
  });

  test("falls back to default when DB_POOL_MAX is invalid string", () => {
    process.env.DB_POOL_MAX = "invalid";
    process.env.DB_USER = "test";
    
    const config = loadConfig();
    const firstKey = Object.keys(config.connections)[0];
    assert.strictEqual(config.connections[firstKey].poolMax, DEFAULT_POOL_MAX);
  });
});
