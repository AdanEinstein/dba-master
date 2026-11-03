import type { Config, ConnectionConfig } from "../../config.js";
import type { Capabilities, DatabaseProvider } from "../../domain/database-provider.js";
import type {
  TableRef, TableSchema, ViewRef, ViewSchema, Relationships, DdlResult,
  ProcedureRef, PackageRef, ScheduledJob, RunSqlResult,
  ColumnInfo, ForeignKey, IndexInfo, CheckConstraint, SchemaInventory,
} from "../../domain/types.js";
import { SqlServerConnection } from "./sqlserver-connection.js";
import {
  SqlServerQueries,
  type SsColumnRow, type SsFkRow, type SsIndexRow, type SsCheckRow, type SsDdlColumnRow,
} from "./sqlserver-queries.js";

// Adapter SQL Server: implementa o port DatabaseProvider usando `mssql` (tedious).
// Concentra o que é específico do T-SQL: driver, catálogo sys.* e mapeamento de tipos.
// SQL Server não tem packages; SQL Agent (msdb) fica fora → scheduledJobs: false.

export class SqlServerProvider implements DatabaseProvider {
  readonly engine = "sqlserver";
  readonly capabilities: Capabilities = { packages: false, scheduledJobs: false };

  private readonly conn: SqlServerConnection;
  private readonly q: SqlServerQueries;

  constructor(connCfg: ConnectionConfig, _globalCfg: Config) {
    this.conn = new SqlServerConnection(connCfg);
    this.q = new SqlServerQueries(this.conn, connCfg.schemaFilter ?? []);
  }

  /** Mapeia tipo SQL Server → tipo TS que o tedious/mssql retorna. */
  typeToTs(dataType: string): string {
    const t = dataType.toLowerCase();
    if (t === "bit") return "boolean";
    if (/^(binary|varbinary|image|timestamp|rowversion)$/.test(t)) return "Buffer"; // timestamp = rowversion
    if (/^(date|datetime|datetime2|smalldatetime|datetimeoffset|time)$/.test(t)) return "Date";
    // bigint volta como string no tedious (preserva precisão)
    if (t === "bigint") return "string";
    if (/^(int|smallint|tinyint|real|float|decimal|numeric|money|smallmoney)$/.test(t)) return "number";
    if (/^(char|varchar|nchar|nvarchar|text|ntext|xml|uniqueidentifier)$/.test(t)) return "string";
    return "unknown"; // sql_variant, hierarchyid, geography, geometry, UDT
  }

  async getObjectFreshness(name: string, schema?: string): Promise<{ owner: string; name: string; token: string } | undefined> {
    const rows = await this.q.findObjectFreshness(name, schema);
    if (rows.length !== 1) return undefined; // não achou ou ambíguo → describe resolve
    return rows[0].token ? rows[0] : undefined;
  }

  async listTables(schema?: string): Promise<TableRef[]> {
    return (await this.q.findTables(schema)).map(toTableRef);
  }

  async searchTables(pattern: string, schema?: string): Promise<TableRef[]> {
    return (await this.q.findTables(schema, pattern)).map(toTableRef);
  }

  async describeTable(table: string, schema?: string): Promise<TableSchema> {
    const { owner, name } = await this.resolveObj(table, "table", schema, "Tabela");

    const cols = await this.q.findColumns(owner, name);
    if (cols.length === 0) throw new Error(`Tabela não encontrada: ${owner}.${name}`);

    const keys = await this.q.findKeyConstraints(owner, name);
    const primaryKey = keys.filter((k) => k.kind === "PRIMARY KEY").map((k) => k.column_name);
    const foreignKeys = groupOutgoing(await this.q.findOutgoingFks(owner, name));
    const indexes = groupIndexes(await this.q.findIndexes(owner, name));
    const checkConstraints = mapChecks(await this.q.findCheckConstraints(owner, name));
    const comment = await this.q.findObjectComment(owner, name);

    return { owner, tableName: name, columns: mapColumns(cols), primaryKey, foreignKeys, indexes, checkConstraints, comment };
  }

  async getRelationships(table: string, schema?: string): Promise<Relationships> {
    const { owner, name } = await this.resolveObj(table, "table", schema, "Tabela");
    const outgoing = groupOutgoing(await this.q.findOutgoingFks(owner, name));
    const incoming = groupIncoming(await this.q.findIncomingFks(owner, name));
    return { owner, tableName: name, outgoing, incoming };
  }

  async getSchemaInventory(schema?: string): Promise<SchemaInventory> {
    const [cols, pks, fks] = await Promise.all([
      this.q.inventoryColumns(schema),
      this.q.inventoryKeyColumns("P", schema),
      this.q.inventoryKeyColumns("R", schema),
    ]);
    return {
      columns: cols.map((r) => ({ owner: r.owner, table: r.table_name, column: r.column_name, dataType: r.data_type })),
      primaryKeys: pks.map((r) => ({ owner: r.owner, table: r.table_name, column: r.column_name })),
      declaredFkColumns: fks.map((r) => ({ owner: r.owner, table: r.table_name, column: r.column_name })),
    };
  }

  async listViews(schema?: string, pattern?: string): Promise<ViewRef[]> {
    const rows = await this.q.findViews(schema, pattern);
    return rows.map((r) => ({ owner: r.owner, viewName: r.view_name }));
  }

  async describeView(view: string, schema?: string): Promise<ViewSchema> {
    const { owner, name } = await this.resolveObj(view, "view", schema, "View");

    const cols = await this.q.findColumns(owner, name);
    if (cols.length === 0) throw new Error(`View não encontrada: ${owner}.${name}`);

    const text = await this.q.findViewText(owner, name);
    const comment = await this.q.findObjectComment(owner, name);
    return { owner, viewName: name, columns: mapColumns(cols), text, comment };
  }

  async getDdl(name: string, schema?: string, objectType?: string): Promise<DdlResult> {
    let owner = schema;
    let type = objectType?.toUpperCase();

    if (!owner || !type) {
      const rows = await this.q.findObjectForDdl(name, schema);
      if (rows.length === 0) throw new Error(`Objeto não encontrado: ${name}`);
      owner = owner ?? rows[0].owner;
      type = type ?? rows[0].object_type;
    }

    let ddl: string;
    switch (type) {
      case "TABLE":
        ddl = await this.buildTableDdl(owner, name);
        break;
      case "VIEW":
      case "PROCEDURE":
      case "FUNCTION":
      case "TRIGGER":
        ddl = (await this.q.fetchModuleDdl(owner, name))
          || `-- Definição indisponível (objeto criptografado ou sem permissão VIEW DEFINITION).`;
        break;
      default:
        ddl = `-- get_ddl não reconstrói objectType '${type}' no SQL Server.`;
    }
    return { owner, objectName: name, objectType: type, ddl };
  }

  async listProcedures(schema?: string, pattern?: string): Promise<ProcedureRef[]> {
    const [rows, args] = await Promise.all([this.q.findRoutines(schema, pattern), this.q.findArguments(schema, pattern)]);
    const byRoutine = new Map<string, ProcedureRef["arguments"]>();
    for (const a of args) {
      const key = `${a.owner}.${a.object_name}`;
      if (!byRoutine.has(key)) byRoutine.set(key, []);
      byRoutine.get(key)!.push({ name: a.argument_name, position: a.position, dataType: a.data_type, inOut: a.in_out });
    }
    return rows.map((r) => ({
      owner: r.owner,
      name: r.object_name,
      packageName: null,
      objectType: r.object_type as "PROCEDURE" | "FUNCTION",
      arguments: byRoutine.get(`${r.owner}.${r.object_name}`) ?? [],
    }));
  }

  // SQL Server não tem packages nem scheduler acessível sem msdb — as tools consultam
  // capabilities antes de chamar; retornamos vazio por robustez.
  async listPackages(): Promise<PackageRef[]> {
    return [];
  }

  async listScheduledJobs(): Promise<ScheduledJob[]> {
    return [];
  }

  async runSql(sql: string, maxRows = 200): Promise<RunSqlResult> {
    // ponytail: o recorte é no cliente (T-SQL não aceita um LIMIT genérico por fora do SQL
    // do usuário). Teto conhecido — para tabelas enormes, use TOP no próprio SQL.
    const rows = (await this.q.runSql(sql)).slice(0, maxRows);
    return { rows, rowCount: rows.length };
  }

  close(): Promise<void> {
    return this.conn.close();
  }

  // --- privados ----------------------------------------------------------

  /** Resolve owner + nome canônico, exigindo 'schema' quando ambíguo. */
  private async resolveObj(
    name: string,
    kind: "table" | "view",
    schema: string | undefined,
    label: string,
  ): Promise<{ owner: string; name: string }> {
    const rows = await this.q.findObjectOwners(name, kind, schema);
    if (rows.length === 0) throw new Error(`${label} não encontrada: ${schema ? `${schema}.` : ""}${name}`);
    const uniq = [...new Map(rows.map((r) => [`${r.owner}.${r.name}`, r])).values()];
    if (uniq.length > 1) {
      throw new Error(
        `${label} ${name} existe em múltiplos schemas: ${uniq.map((r) => r.owner).join(", ")}. Informe 'schema'.`,
      );
    }
    return uniq[0];
  }

  /** Reconstrói o CREATE TABLE (colunas, PK/UNIQUE, FK, CHECK). Índices não-constraint ficam de fora. */
  private async buildTableDdl(owner: string, table: string): Promise<string> {
    const cols = await this.q.findColumnsForDdl(owner, table);
    if (cols.length === 0) throw new Error(`Tabela não encontrada: ${owner}.${table}`);

    const [keys, fks, checks] = await Promise.all([
      this.q.findKeyConstraints(owner, table),
      this.q.findOutgoingFks(owner, table),
      this.q.findCheckConstraints(owner, table),
    ]);

    const lines = cols.map(ddlColumn);

    const keyMap = new Map<string, { kind: string; columns: string[] }>();
    for (const k of keys) {
      if (!keyMap.has(k.constraint_name)) keyMap.set(k.constraint_name, { kind: k.kind, columns: [] });
      keyMap.get(k.constraint_name)!.columns.push(k.column_name);
    }
    for (const [n, k] of keyMap) lines.push(`  CONSTRAINT ${quoteIdent(n)} ${k.kind} (${k.columns.map(quoteIdent).join(", ")})`);

    for (const fk of groupOutgoing(fks)) {
      lines.push(
        `  CONSTRAINT ${quoteIdent(fk.constraintName)} FOREIGN KEY (${fk.columns.map(quoteIdent).join(", ")})` +
        ` REFERENCES ${quoteIdent(fk.referencedOwner)}.${quoteIdent(fk.referencedTable)} (${fk.referencedColumns.map(quoteIdent).join(", ")})`,
      );
    }
    for (const c of mapChecks(checks)) lines.push(`  CONSTRAINT ${quoteIdent(c.name)} CHECK ${c.condition}`);

    return `CREATE TABLE ${quoteIdent(owner)}.${quoteIdent(table)} (\n${lines.join(",\n")}\n);`;
  }
}

// --- Linhas SQL Server → DTO ----------------------------------------------

function toTableRef(r: { owner: string; table_name: string; num_rows: string | number | null }): TableRef {
  return { owner: r.owner, tableName: r.table_name, numRows: r.num_rows == null ? null : Number(r.num_rows) };
}

function mapColumns(cols: SsColumnRow[]): ColumnInfo[] {
  return cols.map((c) => ({
    name: c.column_name,
    dataType: c.data_type,
    nullable: c.nullable === "YES",
    dataLength: c.data_length ?? undefined,
    dataPrecision: c.data_precision,
    dataScale: c.data_scale,
    dataDefault: c.data_default?.trim() ?? null,
    comment: c.comments?.trim() ?? null,
  }));
}

function mapChecks(rows: SsCheckRow[]): CheckConstraint[] {
  return rows
    .map((r) => ({ name: r.constraint_name, condition: (r.search_condition ?? "").trim() }))
    .filter((c) => c.condition);
}

function groupOutgoing(rows: SsFkRow[]): ForeignKey[] {
  const map = new Map<string, ForeignKey>();
  for (const r of rows) {
    let fk = map.get(r.constraint_name);
    if (!fk) {
      fk = { constraintName: r.constraint_name, columns: [], referencedOwner: r.r_owner, referencedTable: r.r_table, referencedColumns: [] };
      map.set(r.constraint_name, fk);
    }
    fk.columns.push(r.column_name);
    fk.referencedColumns.push(r.r_column);
  }
  return [...map.values()];
}

/** Entrada: columns = colunas da tabela filha; referencedColumns = colunas desta tabela. */
function groupIncoming(rows: SsFkRow[]): ForeignKey[] {
  const map = new Map<string, ForeignKey>();
  for (const r of rows) {
    let fk = map.get(r.constraint_name);
    if (!fk) {
      fk = { constraintName: r.constraint_name, columns: [], referencedOwner: r.owner, referencedTable: r.table_name, referencedColumns: [] };
      map.set(r.constraint_name, fk);
    }
    fk.columns.push(r.column_name);
    fk.referencedColumns.push(r.r_column);
  }
  return [...map.values()];
}

function groupIndexes(rows: SsIndexRow[]): IndexInfo[] {
  const map = new Map<string, IndexInfo>();
  for (const r of rows) {
    let idx = map.get(r.index_name);
    if (!idx) {
      idx = { indexName: r.index_name, unique: r.uniqueness === "UNIQUE", columns: [] };
      map.set(r.index_name, idx);
    }
    idx.columns.push(r.column_name);
  }
  return [...map.values()];
}

/** Tipo com tamanho/precisão, como no CREATE TABLE (nchar/nvarchar: max_length está em bytes). */
export function formatType(c: Pick<SsDdlColumnRow, "data_type" | "max_length" | "precision" | "scale">): string {
  const t = c.data_type;
  if (/^(char|varchar|binary|varbinary)$/.test(t)) return `${t}(${c.max_length === -1 ? "MAX" : c.max_length})`;
  if (/^(nchar|nvarchar)$/.test(t)) return `${t}(${c.max_length === -1 ? "MAX" : c.max_length / 2})`;
  if (/^(decimal|numeric)$/.test(t)) return `${t}(${c.precision},${c.scale})`;
  if (/^(datetime2|time|datetimeoffset)$/.test(t)) return `${t}(${c.scale})`;
  return t;
}

function ddlColumn(c: SsDdlColumnRow): string {
  if (c.computed != null) return `  ${quoteIdent(c.name)} AS ${c.computed}`;
  let l = `  ${quoteIdent(c.name)} ${formatType(c)}`;
  if (c.is_identity) l += ` IDENTITY(${c.seed ?? 1},${c.incr ?? 1})`;
  l += c.is_nullable ? " NULL" : " NOT NULL";
  if (c.default != null) l += ` DEFAULT ${c.default}`;
  return l;
}

/** Sempre entre colchetes — válido para qualquer nome em T-SQL. */
export function quoteIdent(id: string): string {
  return `[${id.replace(/\]/g, "]]")}]`;
}
