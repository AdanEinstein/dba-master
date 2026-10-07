import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import type { Config } from "../../config.js";
import { jsonResult, errorResult, connectionArg, schemaArg, assertWritable, readSourceFile } from "../shared.js";

// Compila objeto de banco (packages PL/SQL etc.). DB-agnóstica: só depende do método
// opcional compileObject da porta — engine sem ele responde supported:false.
// É DDL (invalida dependentes) → mesma guarda read-only de run_sql.
export function register(server: McpServer, provider: ProviderManager, cfg: Config): void {
  server.registerTool(
    "compile_object",
    {
      title: "Compilar objeto",
      description:
        "DDL. Recompila objeto existente (name) ou executa script de deploy (sourceFile = caminho do " +
        "arquivo, qualquer tamanho/encoding; ou source inline p/ fonte curta). Script SQL*Plus: PL/SQL e " +
        "blocos até '/', SQL até ';', comandos SET/PROMPT/... pulados. Status por unidade " +
        "VALID/INVALID/EXECUTED/SKIPPED/FAILED + erros linha/coluna. " +
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
          source: z.string().optional().describe("Fonte inline (curta). Fonte grande: use sourceFile."),
          sourceFile: z.string().optional().describe("Caminho absoluto do arquivo .sql/.pkb/... a executar."),
          encoding: z.string().optional().describe("Encoding do arquivo. Omitido = BOM > UTF-8 > windows-1252."),
        })
        .refine((a) => a.name || a.source || a.sourceFile, { message: "Informe name, source ou sourceFile." }),
    },
    async ({ connectionName, name, schema, objectType, source, sourceFile, encoding }) => {
      const db = provider.getProvider(connectionName);
      const conn = provider.resolveConnectionName(connectionName);
      try {
        if (!db.compileObject) return jsonResult({ supported: false, engine: db.engine });
        assertWritable(cfg, conn, "compile_object");
        // Arquivo lido aqui (servidor local): fonte de centenas de KB não cabe num argumento de tool.
        let file: Awaited<ReturnType<typeof readSourceFile>> | undefined;
        try {
          file = sourceFile ? await readSourceFile(sourceFile, encoding) : undefined;
        } catch (e) {
          return jsonResult({ ok: false, error: `Não li ${sourceFile}: ${e instanceof Error ? e.message : e}` });
        }
        const src = source ?? file?.text;
        if (src !== undefined && !src.trim()) return jsonResult({ ok: false, error: "Fonte vazia.", results: [] });
        const results = await db.compileObject({ name, schema, objectType, source: src });
        const ok = results.some((r) => r.status !== "SKIPPED") && results.every((r) => ["VALID", "EXECUTED", "SKIPPED"].includes(r.status));
        return jsonResult({ ok, ...(file && { encoding: file.encoding, bytes: file.bytes }), results });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
