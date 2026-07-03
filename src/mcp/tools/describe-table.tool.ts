import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import type { Config } from "../../config.js";
import { writeTableCache, readFreshCache } from "../../infrastructure/schema-cache.js";
import { jsonResult, errorResult, schemaArg , connectionArg } from "../shared.js";

// Compõe a descrição do provider com a geração do cache .ts (cross-cutting, DB-agnóstico).
export function register(server: McpServer, provider: ProviderManager, cfg: Config): void {
  server.registerTool(
    "describe_table",
    {
      title: "Descrever tabela",
      description:
        "Detalha uma tabela: colunas (tipo, nullable, default), PK, FKs de saída, índices. Gera/atualiza a interface .ts em cache. Se o cache está fresco, retorna enxuto apontando o .ts (leia o arquivo). Use force=true p/ forçar o describe completo.",
      inputSchema: z.object({
      connectionName: connectionArg,
      table: z.string().describe("Nome da tabela."), schema: schemaArg,
      force: z.boolean().optional().describe("Ignora o cache e refaz o describe completo. Default: false.") }),
    },
    async ({ connectionName, table, schema, force }) => {
      const db = provider.getProvider(connectionName);
      const resolvedName = provider.resolveConnectionName(connectionName);

      try {
        // Fast-path: 1 query barata de frescor. Se o .ts bate com o token vivo, pula o describe.
        const fresh = db.getObjectFreshness ? await db.getObjectFreshness(table, schema) : undefined;
        if (!force && fresh) {
          const hit = await readFreshCache(cfg.cacheDir, resolvedName, fresh.owner, fresh.name, fresh.token);
          if (hit) {
            return jsonResult({
              cached: true, cacheFile: hit.file,
              owner: fresh.owner, tableName: fresh.name, columnCount: hit.columnCount,
            });
          }
        }

        const s = await db.describeTable(table, schema);
        const cacheFile = await writeTableCache(
          cfg.cacheDir, resolvedName, s.owner, s.tableName, s.columns, db.typeToTs.bind(provider),
          { kind: "table", lastDdlTime: s.lastDdlTime, comment: s.comment, primaryKey: s.primaryKey,
            foreignKeys: s.foreignKeys, checkConstraints: s.checkConstraints, indexes: s.indexes,
            freshToken: fresh?.token },
        );
        return jsonResult({ ...s, cacheFile, cached: false });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
