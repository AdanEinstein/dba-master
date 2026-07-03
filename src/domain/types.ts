import { createHash } from "node:crypto";

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
  /** COMMENT ON COLUMN (all_col_comments). */
  comment?: string | null;
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

export interface CheckConstraint {
  name: string;
  condition: string;
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
  /** COMMENT ON TABLE/VIEW (all_tab_comments). */
  comment?: string | null;
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
  checkConstraints: CheckConstraint[];
  /** COMMENT ON TABLE (all_tab_comments). */
  comment?: string | null;
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

// --- FK implícita (banco legado sem constraints declaradas) --------------

/** Coluna qualquer do schema (inventário para inferência de FK). */
export interface SchemaColumn {
  owner: string;
  table: string;
  column: string;
  dataType: string;
}

/** Coluna que participa de uma PK ou de uma FK declarada. */
export interface SchemaKeyColumn {
  owner: string;
  table: string;
  column: string;
}

/** Inventário de um schema: base da heurística de FK implícita (DB-agnóstico). */
export interface SchemaInventory {
  columns: SchemaColumn[];
  primaryKeys: SchemaKeyColumn[];
  /** Colunas já cobertas por uma FK declarada — excluídas da inferência. */
  declaredFkColumns: SchemaKeyColumn[];
}

/** Candidato a FK implícita detectado por convenção de nome. */
export interface ImpliedRelationship {
  /** "OWNER.TABLE.COLUMN" da coluna candidata. */
  from: string;
  /** "OWNER.TABLE.PKCOLUMN" da tabela alvo. */
  to: string;
  confidence: "high" | "medium";
  evidence: string;
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

/** Metadados que enriquecem a interface gerada (base de conhecimento). */
export interface InterfaceMeta {
  kind: "table" | "view";
  lastDdlTime?: string;
  /** Token de frescor gravado no header (`// fresh:`) p/ a fast-path do cache validar sem describe. */
  freshToken?: string;
  comment?: string | null;
  primaryKey?: string[];
  foreignKeys?: ForeignKey[]; // saída (esta tabela → outra)
  incoming?: ForeignKey[]; // entrada (outra tabela → esta)
  /** FKs implícitas inferidas por nome (banco legado) cuja origem é esta tabela. */
  impliedForeignKeys?: ImpliedRelationship[];
  checkConstraints?: CheckConstraint[];
  indexes?: IndexInfo[];
}

/** Comentário JSDoc de uma linha, escapando o fechamento de bloco. */
function safeComment(text: string): string {
  return text.replace(/\*\//g, "* /").replace(/\s*\n\s*/g, " ").trim();
}

/**
 * Gera o corpo de uma interface TypeScript a partir das colunas de uma tabela/view.
 * DB-agnóstico: recebe o mapeamento de tipos do provider (ex.: NUMBER→number).
 * O bloco JSDoc do objeto traz kind, comentário, PK, UNIQUE, CHECK e relacionamentos.
 */
export function generateInterface(
  schema: string,
  table: string,
  columns: ColumnInfo[],
  typeToTs: TypeMapper,
  meta: InterfaceMeta,
): string {
  const ifaceName = toPascalCase(table);

  // Mapa coluna → FK de saída, para anotar a coluna com seu alvo.
  const colToFk = new Map<string, string>();
  for (const fk of meta.foreignKeys ?? []) {
    fk.columns.forEach((col, i) => {
      const ref = fk.referencedColumns[i] ?? fk.referencedColumns[0];
      colToFk.set(col, `${fk.referencedOwner}.${fk.referencedTable}.${ref}`);
    });
  }

  // Mapa coluna → FK implícita (inferida por nome), para anotar a coluna.
  const colToImplied = new Map<string, ImpliedRelationship>();
  for (const r of meta.impliedForeignKeys ?? []) {
    colToImplied.set(r.from.split(".").pop() ?? "", r);
  }

  const lines = columns.map((c) => {
    const tsType = typeToTs(c.dataType);
    const key = IDENT.test(c.name) ? c.name : JSON.stringify(c.name);
    const opt = c.nullable ? "?" : "";
    const nul = c.nullable ? " | null" : "";
    const parts = [`${c.dataType}${c.nullable ? " (nullable)" : ""}`];
    if (c.comment) parts.push(safeComment(c.comment));
    const fk = colToFk.get(c.name);
    if (fk) parts.push(`FK → ${fk}`);
    const implied = colToImplied.get(c.name);
    if (implied) parts.push(`FK? → ${implied.to} (implícita, ${implied.confidence})`);
    return `  /** ${parts.join(" — ")} */\n  ${key}${opt}: ${tsType}${nul};`;
  });

  // Bloco JSDoc do objeto: só emite se houver algo além das colunas.
  const doc: string[] = [];
  if (meta.comment) doc.push(safeComment(meta.comment));
  if (meta.primaryKey?.length) doc.push(`PK: ${meta.primaryKey.join(", ")}`);
  for (const idx of meta.indexes ?? []) {
    if (idx.unique) doc.push(`UNIQUE: ${idx.indexName} (${idx.columns.join(", ")})`);
  }
  for (const ck of meta.checkConstraints ?? []) {
    doc.push(`CHECK: ${ck.name} (${safeComment(ck.condition)})`);
  }
  for (const fk of meta.foreignKeys ?? []) {
    doc.push(`FK → ${fk.referencedOwner}.${fk.referencedTable} (${fk.columns.join(", ")} → ${fk.referencedColumns.join(", ")})`);
  }
  for (const fk of meta.incoming ?? []) {
    // incoming: fk.referenced* é ESTA tabela; fk.columns/table são a tabela filha.
    doc.push(`referenciada por ← ${fk.referencedOwner}.${fk.referencedTable} (${fk.columns.join(", ")} → ${fk.referencedColumns.join(", ")})`);
  }
  for (const r of meta.impliedForeignKeys ?? []) {
    doc.push(`FK implícita (inferida) → ${r.to} [${r.confidence}: ${r.evidence}]`);
  }
  const docBlock = doc.length ? `/**\n${doc.map((l) => ` * ${l}`).join("\n")}\n */\n` : "";

  const body = `${docBlock}export interface ${ifaceName} {\n${lines.join("\n")}\n}\n`;
  const hash = createHash("sha256").update(body).digest("hex");
  // `// fresh:` só entra quando o provider forneceu token — cache antigo sem ela cai como miss.
  const freshLine = meta.freshToken ? `\n// fresh: ${meta.freshToken}` : "";
  const header = `// ${schema}.${table}\n// kind: ${meta.kind}\n// hash: ${hash}${freshLine}\n// gerado por dba-master — não editar à mão`;
  return `${header}\n${body}`;
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
