import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";

import { z } from "zod";
import { jsonResult } from "../shared.js";

export function register(server: McpServer, provider: ProviderManager): void {
  server.registerTool(
    "list_connections",
    {
      title: "Listar conexões",
      description: "Lista as conexões configuradas no dba-master.",
      inputSchema: z.object({}),
    },
    async () => jsonResult({ connections: provider.getAvailableConnections() }),
  );
}
