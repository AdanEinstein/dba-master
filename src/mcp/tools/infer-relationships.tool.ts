import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import { inferImplicitFks } from "../../domain/infer-relationships.js";
import { jsonResult, errorResult, schemaArg, connectionArg, tabular, limitArg } from "../shared.js";

export function register(server: McpServer, provider: ProviderManager): void {
  server.registerTool(
    "infer_relationships",
    {
      title: "FKs implícitas (banco legado)",
      description:
        "Infere FKs não declaradas por convenção de nome (ex.: PEDIDO.CLIENTE_ID → CLIENTE.ID), com confiança e evidência. Para bancos legados sem constraints.",
      inputSchema: z.object({ connectionName: connectionArg, schema: schemaArg, limit: limitArg }),
    },
    async ({ connectionName, schema, limit }) => {
      const db = provider.getProvider(connectionName);
      try {
        const inventory = await db.getSchemaInventory(schema);
        return jsonResult(tabular(inferImplicitFks(inventory), limit));
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
