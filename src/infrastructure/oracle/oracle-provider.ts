import type { Config, ConnectionConfig } from "../../config.js";
import type { Capabilities, DatabaseProvider } from "../../domain/database-provider.js";
import type {
  TableRef, TableSchema, ViewRef, ViewSchema, Relationships, DdlResult,
  ProcedureRef, PackageRef, ScheduledJob, RunSqlResult,
  ColumnInfo, ForeignKey, IndexInfo, ArgumentInfo, CheckConstraint,
} from "../../domain/types.js";
import { OracleConnection } from "./oracle-connection.js";
import { OracleQueries, type ColumnRow, type FkRow, type IndexRow, type CheckRow } from "./oracle-queries.js";

// Adapter Oracle: implementa o port DatabaseProvider usando node-oracledb.
// Concentra o que é específico do Oracle: driver, SQL ALL_*/DBMS_METADATA e mapeamento de tipos.

export class OracleProvider implements DatabaseProvider {
  readonly engine = "oracle";
  readonly capabilities: Capabilities = { packages: true, scheduledJobs: true };

  private readonly conn: OracleConnection;
  private readonly q: OracleQueries;

  constructor(connCfg: ConnectionConfig, globalCfg: Config) {
    this.conn = new OracleConnection(connCfg);
    this.q = new OracleQueries(this.conn, globalCfg);
  }

  /** Mapeia tipo Oracle → tipo TS que o driver oracledb retorna. */
  typeToTs(dataType: string): string {
    const t = dataType.toUpperCase();
    if (/^(VARCHAR2|NVARCHAR2|CHAR|NCHAR|CLOB|NCLOB|LONG|ROWID|UROWID)/.test(t)) return "string";
    if (/^(NUMBER|FLOAT|BINARY_FLOAT|BINARY_DOUBLE|INTEGER|DEC|NUMERIC|SMALLINT)/.test(t)) return "number";
    if (/^(DATE|TIMESTAMP)/.test(t)) return "Date"; // oracledb retorna JS Date para DATE/TIMESTAMP
    if (/^(BLOB|RAW|LONG RAW|BFILE)/.test(t)) return "Buffer";
    return "unknown";
  }

  async listTables(schema?: string): Promise<TableRef[]> {
    const rows = await this.q.findTables(schema);
    return rows.map((r) => ({ owner: r.OWNER, tableName: r.TABLE_NAME, numRows: r.NUM_ROWS }));
  }

  async searchTables(pattern: string, schema?: string): Promise<TableRef[]> {
    const rows = await this.q.findTables(schema, pattern);
    return rows.map((r) => ({ owner: r.OWNER, tableName: r.TABLE_NAME, numRows: r.NUM_ROWS }));
  }

  async describeTable(table: string, schema?: string): Promise<TableSchema> {
    const owner = await this.resolveOwner(table, schema);
    const tab = table.toUpperCase();

    const cols = await this.q.findColumns(owner, tab);
    if (cols.length === 0) throw new Error(`Tabela não encontrada: ${owner}.${tab}`);
    const columns = mapColumns(cols);

    const primaryKey = (await this.q.findPrimaryKey(owner, tab)).map((r) => r.COLUMN_NAME);
    const foreignKeys = groupOutgoing(await this.q.findOutgoingFks(owner, tab));
    const indexes = groupIndexes(await this.q.findIndexes(owner, tab));
    const checkConstraints = mapChecks(await this.q.findCheckConstraints(owner, tab));
    const comment = await this.q.findObjectComment(owner, tab);
    const lastDdlTime = await this.q.findLastDdlTime(owner, tab);

    return { owner, tableName: tab, columns, primaryKey, foreignKeys, indexes, checkConstraints, comment, lastDdlTime };
  }

  async getRelationships(table: string, schema?: string): Promise<Relationships> {
    const owner = await this.resolveOwner(table, schema);
    const tab = table.toUpperCase();
    const outgoing = groupOutgoing(await this.q.findOutgoingFks(owner, tab));
    const incoming = groupIncoming(await this.q.findIncomingFks(owner, tab));
    return { owner, tableName: tab, outgoing, incoming };
  }

  async listViews(schema?: string, pattern?: string): Promise<ViewRef[]> {
    const rows = await this.q.findViews(schema, pattern);
    return rows.map((r) => ({ owner: r.OWNER, viewName: r.VIEW_NAME }));
  }

  async describeView(view: string, schema?: string): Promise<ViewSchema> {
    const owner = await this.resolveViewOwner(view, schema);
    const vw = view.toUpperCase();

    const cols = await this.q.findColumns(owner, vw);
    if (cols.length === 0) throw new Error(`View não encontrada: ${owner}.${vw}`);

    const text = await this.q.findViewText(owner, vw);
    const comment = await this.q.findObjectComment(owner, vw);
    const lastDdlTime = await this.q.findLastDdlTime(owner, vw, "VIEW");

    return { owner, viewName: vw, columns: mapColumns(cols), text, comment, lastDdlTime };
  }

  async getDdl(name: string, schema?: string, objectType?: string): Promise<DdlResult> {
    const obj = name.toUpperCase();
    let owner = schema?.toUpperCase();
    let type = objectType?.toUpperCase();

    if (!owner || !type) {
      const rows = await this.q.findObjectForDdl(obj, schema);
      if (rows.length === 0) throw new Error(`Objeto não encontrado: ${obj}`);
      owner = owner ?? rows[0].OWNER;
      type = type ?? rows[0].OBJECT_TYPE;
    }

    // DBMS_METADATA usa 'PACKAGE_BODY' (underscore) para o corpo do package.
    const ddl = await this.q.fetchDdl(type.replace(/ /g, "_"), obj, owner);
    return { owner, objectName: obj, objectType: type, ddl };
  }

  async listProcedures(schema?: string, pattern?: string): Promise<ProcedureRef[]> {
    const rows = await this.q.findRoutines(schema, pattern);
    const out: ProcedureRef[] = [];
    for (const r of rows) {
      out.push({
        owner: r.OWNER,
        name: r.OBJECT_NAME,
        packageName: null,
        objectType: r.OBJECT_TYPE as "PROCEDURE" | "FUNCTION",
        arguments: await this.loadArguments(r.OWNER, r.OBJECT_NAME, null),
      });
    }
    return out;
  }

  async listPackages(schema?: string, pattern?: string): Promise<PackageRef[]> {
    const pkgs = await this.q.findPackages(schema, pattern);
    const out: PackageRef[] = [];
    for (const p of pkgs) {
      const subs = await this.q.findPackageSubprograms(p.OWNER, p.OBJECT_NAME);
      const subprograms: ProcedureRef[] = [];
      for (const s of subs) {
        subprograms.push({
          owner: p.OWNER,
          name: s.PROCEDURE_NAME,
          packageName: p.OBJECT_NAME,
          objectType: "PROCEDURE", // ALL_PROCEDURES não distingue func/proc de forma confiável
          arguments: await this.loadArguments(p.OWNER, s.PROCEDURE_NAME, p.OBJECT_NAME),
        });
      }
      out.push({ owner: p.OWNER, name: p.OBJECT_NAME, subprograms });
    }
    return out;
  }

  async listScheduledJobs(schema?: string, pattern?: string): Promise<ScheduledJob[]> {
    const rows = await this.q.findSchedulerJobs(schema, pattern);
    return rows.map((r) => ({
      owner: r.OWNER,
      jobName: r.JOB_NAME,
      jobAction: r.JOB_ACTION,
      scheduleType: r.SCHEDULE_TYPE,
      repeatInterval: r.REPEAT_INTERVAL,
      enabled: r.ENABLED === "TRUE",
      state: r.STATE,
      lastStartDate: r.LAST_START_DATE?.toISOString() ?? null,
      nextRunDate: r.NEXT_RUN_DATE?.toISOString() ?? null,
      comments: r.COMMENTS,
      engineSpecific: { jobStyle: r.JOB_STYLE, jobType: r.JOB_TYPE },
    }));
  }

  async runSql(sql: string, maxRows = 200): Promise<RunSqlResult> {
    const rows = await this.q.runSql(sql, maxRows);
    return { rows, rowCount: rows.length };
  }

  close(): Promise<void> {
    return this.conn.close();
  }

  // --- privados ----------------------------------------------------------

  private async resolveOwner(table: string, schema?: string): Promise<string> {
    if (schema) return schema.toUpperCase();
    const rows = await this.q.findTableOwners(table);
    if (rows.length === 0) throw new Error(`Tabela não encontrada: ${table}`);
    if (rows.length > 1)
      throw new Error(
        `Tabela ${table} existe em múltiplos schemas: ${rows.map((r) => r.OWNER).join(", ")}. Informe 'schema'.`,
      );
    return rows[0].OWNER;
  }

  private async resolveViewOwner(view: string, schema?: string): Promise<string> {
    if (schema) return schema.toUpperCase();
    const rows = await this.q.findViewOwners(view);
    if (rows.length === 0) throw new Error(`View não encontrada: ${view}`);
    if (rows.length > 1)
      throw new Error(
        `View ${view} existe em múltiplos schemas: ${rows.map((r) => r.OWNER).join(", ")}. Informe 'schema'.`,
      );
    return rows[0].OWNER;
  }

  private async loadArguments(owner: string, objectName: string, packageName: string | null): Promise<ArgumentInfo[]> {
    const rows = await this.q.findArguments(owner, objectName, packageName);
    return rows.map((r) => ({
      name: r.ARGUMENT_NAME,
      position: r.POSITION,
      dataType: r.DATA_TYPE,
      inOut: r.IN_OUT,
    }));
  }
}

// --- Colunas / FKs / índices (linhas Oracle → DTO) ------------------------

/** Mapeia linhas de all_tab_columns → ColumnInfo. Usado por tabelas e views. */
function mapColumns(cols: ColumnRow[]): ColumnInfo[] {
  return cols.map((c) => ({
    name: c.COLUMN_NAME,
    dataType: c.DATA_TYPE,
    nullable: c.NULLABLE === "Y",
    dataLength: c.DATA_LENGTH,
    dataPrecision: c.DATA_PRECISION,
    dataScale: c.DATA_SCALE,
    dataDefault: c.DATA_DEFAULT?.trim() ?? null,
    comment: c.COMMENTS?.trim() ?? null,
  }));
}

// Oracle grava NOT NULL como check constraint `"COL" IS NOT NULL` — a nullability
// já vem da coluna, então descartamos essas para não poluir o JSDoc.
const NOT_NULL_CHECK = /^"?\w+"?\s+IS\s+NOT\s+NULL$/i;

function mapChecks(rows: CheckRow[]): CheckConstraint[] {
  return rows
    .map((r) => ({ name: r.CONSTRAINT_NAME, condition: (r.SEARCH_CONDITION ?? "").trim() }))
    .filter((c) => c.condition && !NOT_NULL_CHECK.test(c.condition));
}


function groupOutgoing(rows: FkRow[]): ForeignKey[] {
  const map = new Map<string, ForeignKey>();
  for (const r of rows) {
    let fk = map.get(r.CONSTRAINT_NAME);
    if (!fk) {
      fk = { constraintName: r.CONSTRAINT_NAME, columns: [], referencedOwner: r.R_OWNER, referencedTable: r.R_TABLE, referencedColumns: [] };
      map.set(r.CONSTRAINT_NAME, fk);
    }
    fk.columns.push(r.COLUMN_NAME);
    fk.referencedColumns.push(r.R_COLUMN);
  }
  return [...map.values()];
}

/** Entrada: columns = colunas da tabela filha; referencedColumns = colunas desta tabela. */
function groupIncoming(rows: FkRow[]): ForeignKey[] {
  const map = new Map<string, ForeignKey>();
  for (const r of rows) {
    let fk = map.get(r.CONSTRAINT_NAME);
    if (!fk) {
      fk = { constraintName: r.CONSTRAINT_NAME, columns: [], referencedOwner: r.OWNER, referencedTable: r.TABLE_NAME, referencedColumns: [] };
      map.set(r.CONSTRAINT_NAME, fk);
    }
    fk.columns.push(r.COLUMN_NAME);
    fk.referencedColumns.push(r.R_COLUMN);
  }
  return [...map.values()];
}

function groupIndexes(rows: IndexRow[]): IndexInfo[] {
  const map = new Map<string, IndexInfo>();
  for (const r of rows) {
    let idx = map.get(r.INDEX_NAME);
    if (!idx) {
      idx = { indexName: r.INDEX_NAME, unique: r.UNIQUENESS === "UNIQUE", columns: [] };
      map.set(r.INDEX_NAME, idx);
    }
    idx.columns.push(r.COLUMN_NAME);
  }
  return [...map.values()];
}
