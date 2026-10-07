import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import type { Config } from "../../config.js";
import { jsonResult, errorResult, connectionArg, schemaArg, assertWritable } from "../shared.js";

// Compila objeto de banco (packages PL/SQL etc.). DB-agnóstica: só depende do método
// opcional compileObject da porta — engine sem ele responde supported:false.
// É DDL (invalida dependentes) → mesma guarda read-only de run_sql.
export function register(server: McpServer, provider: ProviderManager, cfg: Config): void {
  server.registerTool(
    "compile_object",
    {
      title: "Compilar objeto",
      description:
        "DDL. Recompila objeto existente (name) ou faz deploy de fonte CREATE OR REPLACE (source, " +
        "unidades separadas por linha '/'). Devolve status VALID/INVALID e erros linha/coluna. " +
        "Hoje só Oracle (package, body, procedure, function, trigger, type, view); exige readOnly:false.",
      inputSchema: z
        .object({
          connectionName: connectionArg,
          name: z.string().optional().describe("Objeto a recompilar. Ignorado se source vier."),
          schema: schemaArg,
          objectType: z
            .string()
            .optional()
            .describe("PACKAGE (spec+body), PACKAGE BODY, PROCEDURE, ... Autodetecta se omitido."),
          source: z.string().optional().describe("Fonte CREATE OR REPLACE a compilar (deploy)."),
        })
        .refine((a) => a.name || a.source, { message: "Informe name ou source." }),
    },
    async ({ connectionName, name, schema, objectType, source }) => {
      const db = provider.getProvider(connectionName);
      const conn = provider.resolveConnectionName(connectionName);
      try {
        if (!db.compileObject) return jsonResult({ supported: false, engine: db.engine });
        assertWritable(cfg, conn, "compile_object");
        const results = await db.compileObject({ name, schema, objectType, source });
        return jsonResult({ ok: results.length > 0 && results.every((r) => r.status === "VALID"), results });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
