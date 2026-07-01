import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import { jsonResult, errorResult, schemaArg, patternArg , connectionArg } from "../shared.js";

export function register(server: McpServer, provider: ProviderManager): void {
  server.registerTool(
    "list_packages",
    {
      title: "Listar packages",
      description:
        "Lista packages e, para cada um, os subprogramas expostos com suas assinaturas. Nem todo banco tem packages.",
      inputSchema: z.object({
      connectionName: connectionArg,
      schema: schemaArg, pattern: patternArg }),
    },
    async ({ connectionName, schema, pattern }) => {
      const db = provider.getProvider(connectionName);

      try {
        // Bancos sem o conceito de package (ex.: Postgres) respondem sem erro.
        if (!db.capabilities.packages) {
          return jsonResult({ supported: false, engine: db.engine, packages: [] });
        }
        return jsonResult({ supported: true, packages: await db.listPackages(schema, pattern) });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
