import type { Config, ConnectionConfig } from "../../config.js";
import type { Capabilities, DatabaseProvider } from "../../domain/database-provider.js";
import type {
  TableRef, TableSchema, ViewRef, ViewSchema, Relationships, DdlResult,
  ProcedureRef, PackageRef, ScheduledJob, RunSqlResult,
  ColumnInfo, ForeignKey, IndexInfo, CheckConstraint, SchemaInventory,
} from "../../domain/types.js";
import { PgConnection } from "./pg-connection.js";
import {
  PgQueries,
  type PgColumnRow, type PgFkRow, type PgIndexRow, type PgCheckRow,
} from "./pg-queries.js";

// Adapter Postgres: implementa o port DatabaseProvider usando node-postgres.
// Concentra o que é específico do PG: driver, SQL information_schema/pg_catalog e
// mapeamento de tipos. Postgres não tem packages nem scheduler nativo (capabilities).

export class PgProvider implements DatabaseProvider {
  readonly engine = "postgres";
  readonly capabilities: Capabilities = { packages: false, scheduledJobs: false };

  private readonly conn: PgConnection;
  private readonly q: PgQueries;

  constructor(connCfg: ConnectionConfig, _globalCfg: Config) {
    this.conn = new PgConnection(connCfg);
    this.q = new PgQueries(this.conn, connCfg.schemaFilter ?? []);
  }

  /** Mapeia tipo Postgres → tipo TS que o node-postgres retorna. */
  typeToTs(dataType: string): string {
    const t = dataType.toLowerCase();
    if (t === "boolean") return "boolean";
    if (t === "bytea") return "Buffer";
    if (/^(timestamp|date)/.test(t)) return "Date"; // node-postgres retorna JS Date
    if (/^(smallint|integer|real|double precision|int2|int4|float4|float8|smallserial|serial)/.test(t)) return "number";
    // bigint/numeric/decimal/money vêm como string no node-postgres (preserva precisão)
    if (/^(bigint|int8|numeric|decimal|money|bigserial)/.test(t)) return "string";
    if (/^(character|varchar|char|bpchar|text|name|uuid|xml|citext|inet|cidr|macaddr|time|interval|tsvector|tsquery)/.test(t)) return "string";
    return "unknown"; // json/jsonb/array/user-defined/record/hstore
  }

  async getObjectFreshness(name: string, schema?: string): Promise<{ owner: string; name: string; token: string } | undefined> {
    const rows = await this.q.findObjectFreshness(name, schema);
    if (rows.length !== 1) return undefined; // não achou ou ambíguo → describe resolve
    return rows[0].token ? { owner: rows[0].owner, name: rows[0].name, token: rows[0].token } : undefined;
  }

  async listTables(schema?: string): Promise<TableRef[]> {
    const rows = await this.q.findTables(schema);
    return rows.map(toTableRef);
  }

  async searchTables(pattern: string, schema?: string): Promise<TableRef[]> {
    const rows = await this.q.findTables(schema, pattern);
    return rows.map(toTableRef);
  }

  async describeTable(table: string, schema?: string): Promise<TableSchema> {
    const { owner, name } = await this.resolveObj(table, ["r", "p"], schema, "Tabela");

    const cols = await this.q.findColumns(owner, name);
    if (cols.length === 0) throw new Error(`Tabela não encontrada: ${owner}.${name}`);

    const columns = mapColumns(cols);
    const primaryKey = (await this.q.findPrimaryKey(owner, name)).map((r) => r.column_name);
    const foreignKeys = groupOutgoing(await this.q.findOutgoingFks(owner, name));
    const indexes = groupIndexes(await this.q.findIndexes(owner, name));
    const checkConstraints = mapChecks(await this.q.findCheckConstraints(owner, name));
    const comment = await this.q.findObjectComment(owner, name);

    return { owner, tableName: name, columns, primaryKey, foreignKeys, indexes, checkConstraints, comment };
  }

  async getRelationships(table: string, schema?: string): Promise<Relationships> {
    const { owner, name } = await this.resolveObj(table, ["r", "p"], schema, "Tabela");
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
    const { owner, name } = await this.resolveObj(view, ["v", "m"], schema, "View");

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
      case "MATERIALIZED VIEW":
        ddl = await this.buildViewDdl(owner, name, type);
        break;
      case "FUNCTION":
      case "PROCEDURE":
        ddl = await this.q.fetchFunctionDdl(owner, name);
        break;
      default:
        ddl = `-- get_ddl não reconstrói objectType '${type}' no Postgres.`;
    }
    return { owner, objectName: name, objectType: type, ddl };
  }

  async listProcedures(schema?: string, pattern?: string): Promise<ProcedureRef[]> {
    const rows = await this.q.findRoutines(schema, pattern);
    const out: ProcedureRef[] = [];
    for (const r of rows) {
      const args = await this.q.findArguments(r.owner, r.object_name);
      out.push({
        owner: r.owner,
        name: r.object_name,
        packageName: null,
        objectType: r.object_type as "PROCEDURE" | "FUNCTION",
        arguments: args.map((a) => ({
          name: a.argument_name,
          position: a.position,
          dataType: a.data_type,
          inOut: a.in_out,
        })),
      });
    }
    return out;
  }

  // Postgres não tem packages nem scheduler nativo — as tools consultam
  // capabilities antes de chamar; retornamos vazio por robustez.
  async listPackages(): Promise<PackageRef[]> {
    return [];
  }

  async listScheduledJobs(): Promise<ScheduledJob[]> {
    return [];
  }

  async runSql(sql: string, maxRows = 200): Promise<RunSqlResult> {
    // ponytail: node-postgres não limita no servidor via API; recortamos o
    // resultado. Teto conhecido — para tabelas enormes, adicione LIMIT no SQL.
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
    relkinds: string[],
    schema: string | undefined,
    label: string,
  ): Promise<{ owner: string; name: string }> {
    const rows = await this.q.findObjectOwners(name, relkinds, schema);
    if (rows.length === 0) throw new Error(`${label} não encontrada: ${schema ? `${schema}.` : ""}${name}`);
    const uniq = [...new Map(rows.map((r) => [`${r.owner}.${r.name}`, r])).values()];
    if (uniq.length > 1) {
      throw new Error(
        `${label} ${name} existe em múltiplos schemas: ${uniq.map((r) => r.owner).join(", ")}. Informe 'schema'.`,
      );
    }
    return uniq[0];
  }

  private async buildTableDdl(owner: string, table: string): Promise<string> {
    const cols = await this.q.findColumnsForDdl(owner, table);
    if (cols.length === 0) throw new Error(`Tabela não encontrada: ${owner}.${table}`);
    const consts = await this.q.findConstraintDefs(owner, table);

    const colLines = cols.map((c) => {
      let l = `  ${quoteIdent(c.name)} ${c.type}`;
      if (c.default != null) l += ` DEFAULT ${c.default}`;
      if (c.not_null) l += " NOT NULL";
      return l;
    });
    const consLines = consts.map((c) => `  CONSTRAINT ${quoteIdent(c.name)} ${c.def}`);

    return `CREATE TABLE ${quoteIdent(owner)}.${quoteIdent(table)} (\n${[...colLines, ...consLines].join(",\n")}\n);`;
  }

  private async buildViewDdl(owner: string, name: string, type: string): Promise<string> {
    const def = await this.q.findViewText(owner, name);
    const kw = type === "MATERIALIZED VIEW" ? "CREATE MATERIALIZED VIEW" : "CREATE OR REPLACE VIEW";
    return `${kw} ${quoteIdent(owner)}.${quoteIdent(name)} AS\n${def}`;
  }
}

// --- Colunas / FKs / índices (linhas Postgres → DTO) ----------------------

function toTableRef(r: { owner: string; table_name: string; num_rows: string | number | null }): TableRef {
  // reltuples é estimativa; -1 = nunca analisada → tratamos como desconhecido.
  const n = r.num_rows == null ? null : Number(r.num_rows);
  return { owner: r.owner, tableName: r.table_name, numRows: n != null && n >= 0 ? n : null };
}

function mapColumns(cols: PgColumnRow[]): ColumnInfo[] {
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

function mapChecks(rows: PgCheckRow[]): CheckConstraint[] {
  return rows
    .map((r) => ({ name: r.constraint_name, condition: (r.search_condition ?? "").trim() }))
    .filter((c) => c.condition);
}

function groupOutgoing(rows: PgFkRow[]): ForeignKey[] {
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
function groupIncoming(rows: PgFkRow[]): ForeignKey[] {
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

function groupIndexes(rows: PgIndexRow[]): IndexInfo[] {
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

/** Cita o identificador só quando necessário (não é minúsculo simples). */
function quoteIdent(id: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(id) ? id : `"${id.replace(/"/g, '""')}"`;
}
