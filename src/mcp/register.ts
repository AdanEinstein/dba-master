import type { McpServer } from "@modelcontextprotocol/server";
import type { ProviderManager } from "../infrastructure/provider-manager.js";
import type { Config } from "../config.js";

import * as listConnections from "./tools/list-connections.tool.js";
import * as listTables from "./tools/list-tables.tool.js";
import * as searchTables from "./tools/search-tables.tool.js";
import * as describeTable from "./tools/describe-table.tool.js";
import * as listViews from "./tools/list-views.tool.js";
import * as describeView from "./tools/describe-view.tool.js";
import * as getRelationships from "./tools/get-relationships.tool.js";
import * as getDdl from "./tools/get-ddl.tool.js";
import * as listProcedures from "./tools/list-procedures.tool.js";
import * as listPackages from "./tools/list-packages.tool.js";
import * as listSchedulersJobs from "./tools/list-schedulers-jobs.tool.js";
import * as runSql from "./tools/run-sql.tool.js";
import * as generateInterfaces from "./tools/generate-interfaces.tool.js";

/** Registra todas as tools no servidor, injetando o provider (e config onde preciso). */
export function registerTools(server: McpServer, provider: ProviderManager, cfg: Config): void {
  listConnections.register(server, provider);
  listTables.register(server, provider);
  searchTables.register(server, provider);
  describeTable.register(server, provider, cfg);
  listViews.register(server, provider);
  describeView.register(server, provider, cfg);
  getRelationships.register(server, provider);
  getDdl.register(server, provider);
  listProcedures.register(server, provider);
  listPackages.register(server, provider);
  listSchedulersJobs.register(server, provider);
  runSql.register(server, provider, cfg);
  generateInterfaces.register(server, provider, cfg);
}
