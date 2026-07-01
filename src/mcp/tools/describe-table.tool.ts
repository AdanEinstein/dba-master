import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { DatabaseProvider } from "../../domain/database-provider.js";
import type { Config } from "../../config.js";
import { writeTableCache } from "../../infrastructure/schema-cache.js";
import { jsonResult, errorResult, schemaArg } from "../shared.js";

// Compõe a descrição do provider com a geração do cache .ts (cross-cutting, DB-agnóstico).
export function register(server: McpServer, provider: DatabaseProvider, cfg: Config): void {
  server.registerTool(
    "describe_table",
    {
      title: "Descrever tabela",
      description:
        "Detalha uma tabela: colunas (tipo, nullable, default), PK, FKs de saída, índices. Gera/atualiza a interface .ts em cache.",
      inputSchema: z.object({ table: z.string().describe("Nome da tabela."), schema: schemaArg }),
    },
    async ({ table, schema }) => {
      try {
        const s = await provider.describeTable(table, schema);
        const cacheFile = await writeTableCache(
          cfg.cacheDir, s.owner, s.tableName, s.columns, provider.typeToTs.bind(provider), s.lastDdlTime,
        );
        return jsonResult({ ...s, cacheFile });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
