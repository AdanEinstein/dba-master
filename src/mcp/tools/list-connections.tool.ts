import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../../infrastructure/provider-manager.js";
import type { Config } from "../../config.js";

import { z } from "zod";
import { jsonResult } from "../shared.js";

export function register(server: McpServer, provider: ProviderManager, cfg: Config): void {
  server.registerTool(
    "list_connections",
    {
      title: "Listar conexões",
      description: "Lista as conexões configuradas; writable = as que aceitam escrita (readOnly:false).",
      inputSchema: z.object({}),
    },
    async () => {
      const connections = provider.getAvailableConnections();
      const writable = connections.filter((n) => cfg.connections[n]?.readOnly === false);
      return jsonResult({ connections, writable });
    },
  );
}
