import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { DatabaseProvider } from "../../domain/database-provider.js";
import { jsonResult, errorResult, schemaArg } from "../shared.js";

export function register(server: McpServer, provider: DatabaseProvider): void {
  server.registerTool(
    "get_ddl",
    {
      title: "Obter DDL",
      description:
        "Retorna o DDL de um objeto (tabela, view, procedure, package, trigger, sequence, type).",
      inputSchema: z.object({
        name: z.string().describe("Nome do objeto."),
        schema: schemaArg,
        objectType: z
          .string()
          .optional()
          .describe("Tipo do objeto (TABLE, VIEW, PROCEDURE, PACKAGE, TRIGGER, ...). Autodetecta se omitido."),
      }),
    },
    async ({ name, schema, objectType }) => {
      try {
        return jsonResult(await provider.getDdl(name, schema, objectType));
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
