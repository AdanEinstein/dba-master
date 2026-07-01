import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { DatabaseProvider } from "../../domain/database-provider.js";
import { jsonResult, errorResult, schemaArg, patternArg } from "../shared.js";

export function register(server: McpServer, provider: DatabaseProvider): void {
  server.registerTool(
    "list_packages",
    {
      title: "Listar packages",
      description:
        "Lista packages e, para cada um, os subprogramas expostos com suas assinaturas. Nem todo banco tem packages.",
      inputSchema: z.object({ schema: schemaArg, pattern: patternArg }),
    },
    async ({ schema, pattern }) => {
      try {
        // Bancos sem o conceito de package (ex.: Postgres) respondem sem erro.
        if (!provider.capabilities.packages) {
          return jsonResult({ supported: false, engine: provider.engine, packages: [] });
        }
        return jsonResult({ supported: true, packages: await provider.listPackages(schema, pattern) });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
