import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import type { Config } from "../../config.js";
import { writeTableCache, readFreshCache } from "../../infrastructure/schema-cache.js";
import { jsonResult, errorResult, schemaArg, connectionArg } from "../shared.js";

// Compõe a descrição da view com a geração do cache .ts (cross-cutting, DB-agnóstico).
export function register(server: McpServer, provider: ProviderManager, cfg: Config): void {
  server.registerTool(
    "describe_view",
    {
      title: "Descrever view",
      description:
        "Grava em cache a interface .ts da view (colunas) e retorna o caminho — leia o arquivo. Para o SELECT que a define, use get_ddl.",
      inputSchema: z.object({
        connectionName: connectionArg,
        view: z.string().describe("Nome da view."),
        schema: schemaArg,
        force: z.boolean().optional().describe("Ignora o cache e refaz o describe completo. Default: false."),
      }),
    },
    async ({ connectionName, view, schema, force }) => {
      const db = provider.getProvider(connectionName);
      const resolvedName = provider.resolveConnectionName(connectionName);

      try {
        // Fast-path: 1 query barata de frescor. Se o .ts bate com o token vivo, pula o describe.
        const fresh = db.getObjectFreshness ? await db.getObjectFreshness(view, schema) : undefined;
        if (!force && fresh) {
          const hit = await readFreshCache(cfg.cacheDir, resolvedName, fresh.owner, fresh.name, fresh.token);
          if (hit) {
            return jsonResult({
              cached: true, cacheFile: hit.file,
              owner: fresh.owner, viewName: fresh.name, columnCount: hit.columnCount,
            });
          }
        }

        const s = await db.describeView(view, schema);
        const cacheFile = await writeTableCache(
          cfg.cacheDir, resolvedName, s.owner, s.viewName, s.columns, db.typeToTs.bind(provider),
          { kind: "view", lastDdlTime: s.lastDdlTime, comment: s.comment, freshToken: fresh?.token },
        );
        // Só o ponteiro, igual ao cache-hit. O SQL da view sai por get_ddl.
        return jsonResult({
          cached: false, cacheFile,
          owner: s.owner, viewName: s.viewName, columnCount: s.columns.length,
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
