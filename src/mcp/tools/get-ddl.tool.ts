import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import { jsonResult, errorResult, schemaArg , connectionArg } from "../shared.js";

export function register(server: McpServer, provider: ProviderManager): void {
  server.registerTool(
    "get_ddl",
    {
      title: "Obter DDL",
      description:
        "Retorna o DDL de um objeto (tabela, view, procedure, package, trigger, sequence, type).",
      inputSchema: z.object({
      connectionName: connectionArg,
      name: z.string().describe("Nome do objeto."),
        schema: schemaArg,
        objectType: z
          .string()
          .optional()
          .describe("Tipo do objeto (TABLE, VIEW, PROCEDURE, PACKAGE, TRIGGER, ...). Autodetecta se omitido."),
      }),
    },
    async ({ connectionName, name, schema, objectType }) => {
      const db = provider.getProvider(connectionName);

      try {
        return jsonResult(await db.getDdl(name, schema, objectType));
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
