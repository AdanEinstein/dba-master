import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { DatabaseProvider } from "../../domain/database-provider.js";
import { jsonResult, errorResult, schemaArg, patternArg } from "../shared.js";

export function register(server: McpServer, provider: DatabaseProvider): void {
  server.registerTool(
    "list_procedures",
    {
      title: "Listar procedures/functions",
      description:
        "Lista procedures e functions standalone (fora de packages), com assinatura de parâmetros (nome, tipo, IN/OUT).",
      inputSchema: z.object({ schema: schemaArg, pattern: patternArg }),
    },
    async ({ schema, pattern }) => {
      try {
        return jsonResult({ procedures: await provider.listProcedures(schema, pattern) });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
