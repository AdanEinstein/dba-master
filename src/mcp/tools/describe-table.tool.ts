import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import type { Config } from "../../config.js";
import { writeTableCache } from "../../infrastructure/schema-cache.js";
import { jsonResult, errorResult, schemaArg , connectionArg } from "../shared.js";

// Compõe a descrição do provider com a geração do cache .ts (cross-cutting, DB-agnóstico).
export function register(server: McpServer, provider: ProviderManager, cfg: Config): void {
  server.registerTool(
    "describe_table",
    {
      title: "Descrever tabela",
      description:
        "Detalha uma tabela: colunas (tipo, nullable, default), PK, FKs de saída, índices. Gera/atualiza a interface .ts em cache.",
      inputSchema: z.object({
      connectionName: connectionArg,
      table: z.string().describe("Nome da tabela."), schema: schemaArg }),
    },
    async ({ connectionName, table, schema }) => {
      const db = provider.getProvider(connectionName);
      const resolvedName = provider.resolveConnectionName(connectionName);

      try {
        const s = await db.describeTable(table, schema);
        const cacheFile = await writeTableCache(
          cfg.cacheDir, resolvedName, s.owner, s.tableName, s.columns, db.typeToTs.bind(provider),
          { kind: "table", lastDdlTime: s.lastDdlTime, comment: s.comment, primaryKey: s.primaryKey,
            foreignKeys: s.foreignKeys, checkConstraints: s.checkConstraints, indexes: s.indexes },
        );
        return jsonResult({ ...s, cacheFile });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
