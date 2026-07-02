import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import { inferImplicitFks } from "../../domain/infer-relationships.js";
import { jsonResult, errorResult, schemaArg, connectionArg } from "../shared.js";

export function register(server: McpServer, provider: ProviderManager): void {
  server.registerTool(
    "infer_relationships",
    {
      title: "FKs implícitas (banco legado)",
      description:
        "Infere FKs não declaradas por convenção de nome (ex.: PEDIDO.CLIENTE_ID → CLIENTE.ID). Cada candidato traz confiança (high/medium) e evidência. Essencial em bancos legados sem constraints.",
      inputSchema: z.object({ connectionName: connectionArg, schema: schemaArg }),
    },
    async ({ connectionName, schema }) => {
      const db = provider.getProvider(connectionName);
      try {
        const inventory = await db.getSchemaInventory(schema);
        return jsonResult(inferImplicitFks(inventory));
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
