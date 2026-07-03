import type { Config, ConnectionConfig } from "../../config.js";
import type {
  DatabaseProvider,
  Capabilities,
} from "../../domain/database-provider.js";
import type {
  TableRef,
  TableSchema,
  ViewRef,
  ViewSchema,
  Relationships,
  SchemaInventory,
  DdlResult,
  ProcedureRef,
  PackageRef,
  ScheduledJob,
  RunSqlResult,
  ColumnInfo,
  ForeignKey,
} from "../../domain/types.js";
import { MysqlConnection } from "./mysql-connection.js";
import { MysqlQueries, type MysqlFkRow } from "./mysql-queries.js";

export class MysqlProvider implements DatabaseProvider {
  public readonly engine = "mysql";
  public readonly capabilities: Capabilities = {
    packages: false,
    scheduledJobs: false,
  };

  private conn: MysqlConnection;
  private queries: MysqlQueries;

  constructor(cfg: ConnectionConfig, globalCfg: Config) {
    this.conn = new MysqlConnection(cfg);
    this.queries = new MysqlQueries(this.conn, cfg.schemaFilter ?? []);
  }

  typeToTs(dataType: string): string {
    const d = dataType.toLowerCase();
    if (d.includes("int") || d.includes("decimal") || d.includes("numeric") || d.includes("float") || d.includes("double")) return "number";
    if (d.includes("char") || d.includes("text") || d.includes("blob") || d.includes("json")) return "string";
    if (d.includes("date") || d.includes("time") || d.includes("year")) return "Date";
    return "unknown";
  }

  async listTables(schema?: string): Promise<TableRef[]> {
    const rows = await this.queries.findTables(schema);
    return rows.map((r) => ({
      owner: r.owner,
      tableName: r.table_name,
      numRows: r.num_rows ? Number(r.num_rows) : null,
    }));
  }

  async searchTables(pattern: string, schema?: string): Promise<TableRef[]> {
    const rows = await this.queries.findTables(schema, pattern);
    return rows.map((r) => ({
      owner: r.owner,
      tableName: r.table_name,
      numRows: r.num_rows ? Number(r.num_rows) : null,
    }));
  }

  async describeTable(table: string, schema?: string): Promise<TableSchema> {
    const tRows = await this.queries.findTables(schema, table);
    const tbl = tRows.find((r) => r.table_name.toLowerCase() === table.toLowerCase());
    if (!tbl) {
      throw new Error(`Tabela ${schema ? schema + "." : ""}${table} não encontrada no MySQL.`);
    }

    const cRows = await this.queries.findColumns(table, schema);
    const columns: ColumnInfo[] = cRows.map((c) => ({
      name: c.column_name,
      dataType: c.data_type,
      tsType: this.typeToTs(c.data_type),
      nullable: c.nullable.toUpperCase() === "YES",
      maxLength: c.data_length,
      precision: c.data_precision,
      scale: c.data_scale,
      defaultValue: c.data_default,
      comments: c.comments,
    }));

    const fkRows = await this.queries.findFks(table, schema, "outgoing");

    return {
      owner: tbl.owner,
      tableName: tbl.table_name,
      columns,
      primaryKey: [],
      foreignKeys: this.groupFks(fkRows),
      indexes: [],
      checkConstraints: [],
    };
  }

  private groupFks(rows: MysqlFkRow[]): ForeignKey[] {
    const map = new Map<string, ForeignKey>();
    for (const r of rows) {
      let fk = map.get(r.constraint_name);
      if (!fk) {
        fk = {
          constraintName: r.constraint_name,
          columns: [],
          referencedTable: r.r_table,
          referencedColumns: [],
          referencedOwner: r.r_owner,
        };
        map.set(r.constraint_name, fk);
      }
      fk.columns.push(r.column_name);
      fk.referencedColumns.push(r.r_column);
    }
    return Array.from(map.values());
  }

  async getRelationships(table: string, schema?: string): Promise<Relationships> {
    const outRows = await this.queries.findFks(table, schema, "outgoing");
    const incRows = await this.queries.findFks(table, schema, "incoming");
    const owner = schema ?? (outRows[0]?.owner || incRows[0]?.owner || "");

    return {
      owner,
      tableName: table,
      outgoing: this.groupFks(outRows),
      incoming: this.groupFks(incRows),
    };
  }

  async getSchemaInventory(schema?: string): Promise<SchemaInventory> {
    throw new Error("Not implemented");
  }

  async listViews(schema?: string, pattern?: string): Promise<ViewRef[]> {
    const rows = await this.queries.findViews(schema, pattern);
    return rows.map((r) => ({
      owner: r.owner,
      viewName: r.view_name,
    }));
  }

  async describeView(view: string, schema?: string): Promise<ViewSchema> {
    const vRows = await this.queries.findViews(schema, view);
    const v = vRows.find((r) => r.view_name.toLowerCase() === view.toLowerCase());
    if (!v) {
      throw new Error(`View ${schema ? schema + "." : ""}${view} não encontrada no MySQL.`);
    }

    const cRows = await this.queries.findColumns(view, schema);
    const columns: ColumnInfo[] = cRows.map((c) => ({
      name: c.column_name,
      dataType: c.data_type,
      tsType: this.typeToTs(c.data_type),
      nullable: c.nullable.toUpperCase() === "YES",
      maxLength: c.data_length,
      precision: c.data_precision,
      scale: c.data_scale,
      defaultValue: c.data_default,
      comments: c.comments,
    }));

    return {
      owner: v.owner,
      viewName: v.view_name,
      text: v.text,
      columns,
    };
  }

  async getDdl(name: string, schema?: string, objectType?: string): Promise<DdlResult> {
    throw new Error("Not implemented");
  }

  async listProcedures(schema?: string, pattern?: string): Promise<ProcedureRef[]> {
    return [];
  }

  async listPackages(schema?: string, pattern?: string): Promise<PackageRef[]> {
    return [];
  }

  async listScheduledJobs(schema?: string, pattern?: string): Promise<ScheduledJob[]> {
    return [];
  }

  async runSql(sql: string, maxRows?: number): Promise<RunSqlResult> {
    throw new Error("Not implemented");
  }

  async close(): Promise<void> {
    await this.conn.close();
  }
}
