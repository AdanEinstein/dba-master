import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import { jsonResult, errorResult, schemaArg, patternArg , connectionArg } from "../shared.js";

export function register(server: McpServer, provider: ProviderManager): void {
  server.registerTool(
    "list_procedures",
    {
      title: "Listar procedures/functions",
      description:
        "Lista procedures e functions standalone (fora de packages), com assinatura de parâmetros (nome, tipo, IN/OUT).",
      inputSchema: z.object({
      connectionName: connectionArg,
      schema: schemaArg, pattern: patternArg }),
    },
    async ({ connectionName, schema, pattern }) => {
      const db = provider.getProvider(connectionName);

      try {
        return jsonResult({ procedures: await db.listProcedures(schema, pattern) });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
