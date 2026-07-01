import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";

import { z } from "zod";

export function register(server: McpServer, provider: ProviderManager): void {
  server.registerTool(
    "list_connections",
    {
      title: "Listar conexões",
      description: "Lista as conexões de banco de dados disponíveis configuradas no dba-master.",
      inputSchema: z.object({}),
    },
    async () => {
      const connections = provider.getAvailableConnections();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ connections }, null, 2),
          },
        ],
      };
    },
  );
}
