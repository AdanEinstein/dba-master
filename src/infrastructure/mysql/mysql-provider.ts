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
    scheduledJobs: true,
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

    const pkRows = await this.queries.findPrimaryKey(tbl.table_name, tbl.owner);
    const idxRows = await this.queries.findIndexes(tbl.table_name, tbl.owner);
    const chkRows = await this.queries.findCheckConstraints(tbl.table_name, tbl.owner);

    const primaryKey = pkRows.map(r => r.column_name);
    
    const idxMap = new Map<string, import("../../domain/types.js").IndexInfo>();
    for (const r of idxRows) {
      let idx = idxMap.get(r.index_name);
      if (!idx) {
        idx = { indexName: r.index_name, unique: r.non_unique === 0, columns: [] };
        idxMap.set(r.index_name, idx);
      }
      idx.columns.push(r.column_name);
    }
    const indexes = Array.from(idxMap.values());

    const checkConstraints = chkRows.map(r => ({ name: r.constraint_name, condition: r.check_clause }));

    return {
      owner: tbl.owner,
      tableName: tbl.table_name,
      columns,
      primaryKey,
      foreignKeys: this.groupFks(fkRows),
      indexes,
      checkConstraints,
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
    const [cols, pks, fks] = await Promise.all([
      this.queries.inventoryColumns(schema),
      this.queries.inventoryKeyColumns("PRIMARY KEY", schema),
      this.queries.inventoryKeyColumns("FOREIGN KEY", schema),
    ]);
    return {
      columns: cols.map((r) => ({ owner: r.owner, table: r.table_name, column: r.column_name, dataType: r.data_type })),
      primaryKeys: pks.map((r) => ({ owner: r.owner, table: r.table_name, column: r.column_name })),
      declaredFkColumns: fks.map((r) => ({ owner: r.owner, table: r.table_name, column: r.column_name })),
    };
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
    const isView = objectType?.toUpperCase() === 'VIEW';
    const type = isView ? 'VIEW' : 'TABLE';
    const target = schema ? `${schema}.${name}` : name;
    try {
      const rows = await this.conn.query<any>(`SHOW CREATE ${type} ${target}`);
      if (rows.length === 0) throw new Error(`Objeto não encontrado: ${target}`);
      
      const row = rows[0];
      const ddl = isView ? row['Create View'] : row['Create Table'];
      
      return {
        owner: schema || "",
        objectName: name,
        objectType: type as "TABLE" | "VIEW",
        ddl,
      };
    } catch (e) {
      throw new Error(`Erro ao gerar DDL para ${target}: ${(e as Error).message}`);
    }
  }

  async listProcedures(schema?: string, pattern?: string): Promise<ProcedureRef[]> {
    const routines = await this.queries.findRoutines(schema, pattern);
    const params = await this.queries.findParameters(schema);

    // Agrupar parâmetros por rotina
    const paramMap = new Map<string, any[]>();
    for (const p of params) {
      const key = `${p.owner}.${p.routine_name}`;
      let list = paramMap.get(key);
      if (!list) {
        list = [];
        paramMap.set(key, list);
      }
      list.push(p);
    }

    return routines.map(r => {
      const key = `${r.owner}.${r.name}`;
      const rParams = paramMap.get(key) || [];
      return {
        owner: r.owner,
        name: r.name,
        packageName: null,
        objectType: r.type as "PROCEDURE" | "FUNCTION",
        arguments: rParams.map(p => ({
          name: p.param_name,
          position: p.position,
          dataType: p.data_type,
          inOut: p.mode
        }))
      };
    });
  }

  async listPackages(schema?: string, pattern?: string): Promise<PackageRef[]> {
    return [];
  }

  async listScheduledJobs(schema?: string, pattern?: string): Promise<ScheduledJob[]> {
    const events = await this.queries.findEvents(schema, pattern);
    return events.map(e => ({
      owner: e.owner,
      jobName: e.job_name,
      jobAction: e.job_action,
      scheduleType: e.schedule_type,
      repeatInterval: e.schedule_type === 'RECURRING' ? e.repeat_interval : null,
      enabled: e.status === 'ENABLED' || e.status === 'SLAVESIDE_DISABLED',
      state: e.status,
      lastStartDate: e.last_executed ? String(e.last_executed) : null,
      nextRunDate: e.schedule_type === 'RECURRING' ? (e.starts ? String(e.starts) : null) : (e.execute_at ? String(e.execute_at) : null),
      comments: e.comments || null,
      engineSpecific: {
        status: e.status,
      }
    }));
  }

  async runSql(sql: string, maxRows = 200): Promise<RunSqlResult> {
    const raw = await this.conn.query<any>(sql);
    const rows = Array.isArray(raw) ? raw.slice(0, maxRows) : [];
    return { rows, rowCount: Array.isArray(raw) ? raw.length : (raw as any).affectedRows || 0 };
  }

  async close(): Promise<void> {
    await this.conn.close();
  }
}
