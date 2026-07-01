// Camada de domínio: modelos (DTOs) e lógica pura, sem dependência de I/O.

// --- Modelos de tabela ---------------------------------------------------

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  dataLength?: number;
  dataPrecision?: number | null;
  dataScale?: number | null;
  dataDefault?: string | null;
}

export interface TableRef {
  owner: string;
  tableName: string;
  numRows: number | null;
}

export interface ForeignKey {
  constraintName: string;
  columns: string[];
  referencedOwner: string;
  referencedTable: string;
  referencedColumns: string[];
}

export interface IndexInfo {
  indexName: string;
  unique: boolean;
  columns: string[];
}

// --- Modelos de view ----------------------------------------------------

export interface ViewRef {
  owner: string;
  viewName: string;
}

/** Descreve uma view: colunas + o SELECT que a define. Views não têm PK/FK/índices. */
export interface ViewSchema {
  owner: string;
  viewName: string;
  columns: ColumnInfo[];
  /** O SELECT da view (all_views.TEXT). */
  text: string;
  /** Timestamp da última mudança de DDL — usado pelo cache incremental. */
  lastDdlTime?: string;
}

/** Retornado pelo provider: descreve a tabela sem o artefato de cache. */
export interface TableSchema {
  owner: string;
  tableName: string;
  columns: ColumnInfo[];
  primaryKey: string[];
  foreignKeys: ForeignKey[];
  indexes: IndexInfo[];
  /** Timestamp da última mudança de DDL — usado pelo cache incremental. */
  lastDdlTime?: string;
}

/** Resposta da tool describe_table: TableSchema + o caminho do .ts gerado. */
export interface TableDescription extends TableSchema {
  cacheFile: string;
}

export interface Relationships {
  owner: string;
  tableName: string;
  outgoing: ForeignKey[];
  incoming: ForeignKey[];
}

// --- Modelos de PL/SQL ---------------------------------------------------

export interface ArgumentInfo {
  name: string | null; // null = valor de retorno de function
  position: number;
  dataType: string | null;
  inOut: string; // IN, OUT, IN/OUT
}

export interface ProcedureRef {
  owner: string;
  name: string;
  /** Nome do package quando o subprograma pertence a um; null se standalone. */
  packageName: string | null;
  objectType: "PROCEDURE" | "FUNCTION";
  arguments: ArgumentInfo[];
}

export interface PackageRef {
  owner: string;
  name: string;
  subprograms: ProcedureRef[];
}

// --- Modelos de scheduler / SQL -----------------------------------------

/** Job agendado, genérico entre bancos. Campos específicos de um engine são opcionais. */
export interface ScheduledJob {
  owner: string;
  jobName: string;
  jobAction: string | null;
  scheduleType: string | null;
  repeatInterval: string | null;
  enabled: boolean;
  state: string | null;
  lastStartDate: string | null;
  nextRunDate: string | null;
  comments: string | null;
  /** Atributos específicos do engine (ex.: job_style/job_type no Oracle). */
  engineSpecific?: Record<string, unknown>;
}

export interface DdlResult {
  owner: string;
  objectName: string;
  objectType: string;
  ddl: string;
}

export interface RunSqlResult {
  rows?: Record<string, unknown>[];
  rowCount: number;
}

// --- Lógica pura ---------------------------------------------------------

/** Converte um tipo nativo do banco para o tipo TypeScript. Cada provider fornece o seu. */
export type TypeMapper = (dataType: string) => string;

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Gera o corpo de uma interface TypeScript a partir das colunas de uma tabela.
 * DB-agnóstico: recebe o mapeamento de tipos do provider (ex.: NUMBER→number).
 */
export function generateInterface(
  schema: string,
  table: string,
  columns: ColumnInfo[],
  typeToTs: TypeMapper,
  lastDdlTime?: string,
): string {
  const ifaceName = toPascalCase(table);
  const lines = columns.map((c) => {
    const tsType = typeToTs(c.dataType);
    const key = IDENT.test(c.name) ? c.name : JSON.stringify(c.name);
    const opt = c.nullable ? "?" : "";
    const nul = c.nullable ? " | null" : "";
    return `  /** ${c.dataType}${c.nullable ? " (nullable)" : ""} */\n  ${key}${opt}: ${tsType}${nul};`;
  });
  const header = `// ${schema}.${table}\n// last_ddl: ${lastDdlTime ?? "unknown"}\n// gerado por dba-master — não editar à mão`;
  return `${header}\nexport interface ${ifaceName} {\n${lines.join("\n")}\n}\n`;
}

/** Classifica um statement: true = escrita (DML/DDL/PLSQL), false = leitura (SELECT/WITH/EXPLAIN). */
export function isWriteStatement(sql: string): boolean {
  const cleaned = sql
    .replace(/--[^\n]*/g, " ") // comentários de linha
    .replace(/\/\*[\s\S]*?\*\//g, " ") // comentários de bloco
    .trim();
  const first = cleaned.split(/\s+/)[0]?.toUpperCase() ?? "";
  return !["SELECT", "WITH", "EXPLAIN"].includes(first);
}

function toPascalCase(name: string): string {
  return name
    .toLowerCase()
    .split(/[_$\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}
