import type { SqlServerConnection } from "./sqlserver-connection.js";

// Acesso a dados do SQL Server: SQL contra as views de catálogo `sys.*`.
// Retorna linhas cruas (colunas em minúsculo, via alias); a transformação em DTO
// fica no provider. Owner = schema (o "database" é fixo por conexão). Nomes são
// casados case-insensitive (LOWER) porque a collation do banco pode ser CS.

export interface SsTableRow { owner: string; table_name: string; num_rows: string | number | null }
export interface SsViewRow { owner: string; view_name: string }
export interface SsOwnerRow { owner: string; name: string }
export interface SsColumnRow {
  column_name: string; data_type: string; nullable: string; data_length: number | null;
  data_precision: number | null; data_scale: number | null; data_default: string | null;
  comments: string | null;
}
export interface SsCheckRow { constraint_name: string; search_condition: string | null }
export interface SsFkRow {
  constraint_name: string; owner: string; table_name: string; column_name: string;
  position: number; r_owner: string; r_table: string; r_column: string;
}
export interface SsIndexRow { index_name: string; uniqueness: string; column_name: string }
export interface SsKeyRow { constraint_name: string; kind: "PRIMARY KEY" | "UNIQUE"; column_name: string }
export interface SsRoutineRow { owner: string; object_name: string; object_type: string }
export interface SsArgumentRow {
  owner: string; object_name: string; argument_name: string | null; position: number;
  data_type: string | null; in_out: string;
}
export interface SsDdlColumnRow {
  name: string; data_type: string; max_length: number; precision: number; scale: number;
  is_nullable: boolean; is_identity: boolean; seed: string | number | null; incr: string | number | null;
  default: string | null; computed: string | null;
}

// Nome do tipo-base (resolve alias types como `sysname` → nvarchar). `ty`/`bt` vêm dos JOINs abaixo.
const TYPE_NAME = "COALESCE(bt.name, ty.name)";
const TYPE_JOINS = (colAlias: string) => `
  JOIN sys.types ty ON ty.user_type_id = ${colAlias}.user_type_id
  LEFT JOIN sys.types bt ON bt.user_type_id = ${colAlias}.system_type_id`;

const ROUTINE_TYPES = "('P','FN','IF','TF')";
const DDL_TYPES = "('U','V','P','FN','IF','TF','TR')";

export class SqlServerQueries {
  constructor(
    private readonly conn: SqlServerConnection,
    private readonly schemaFilter: string[],
  ) {}

  /**
   * Restringe as consultas aos schemas alvo. Sem schema e sem schemaFilter,
   * exclui os schemas de sistema. Empurra os binds em `params` e devolve o fragmento SQL.
   */
  private schemaCond(col: string, params: unknown[], schema?: string): string {
    if (schema) {
      params.push(schema);
      return `LOWER(${col}) = LOWER(@p${params.length})`;
    }
    if (this.schemaFilter.length) {
      const ph = this.schemaFilter.map((s) => {
        params.push(s);
        return `@p${params.length}`;
      }).join(", ");
      return `${col} IN (${ph})`;
    }
    return `${col} NOT IN ('sys', 'INFORMATION_SCHEMA')`;
  }

  /** `[[]` escapa o colchete, que em T-SQL LIKE abre uma classe de caracteres. */
  private likeParam(params: unknown[], pattern: string): string {
    params.push(`%${pattern.replace(/\[/g, "[[]")}%`);
    return `LOWER(@p${params.length})`;
  }

  findTables(schema?: string, pattern?: string): Promise<SsTableRow[]> {
    const params: unknown[] = [];
    const sc = this.schemaCond("s.name", params, schema);
    let where = `t.is_ms_shipped = 0 AND ${sc}`;
    if (pattern) where += ` AND LOWER(t.name) LIKE ${this.likeParam(params, pattern)}`;
    return this.conn.query<SsTableRow>(
      `SELECT s.name AS owner, t.name AS table_name, SUM(p.rows) AS num_rows
         FROM sys.tables t
         JOIN sys.schemas s ON s.schema_id = t.schema_id
         LEFT JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
        WHERE ${where}
        GROUP BY s.name, t.name
        ORDER BY s.name, t.name`,
      params,
    );
  }

  /** Resolve owner + nome canônico de um objeto por tipo (tabela 'U' / view 'V'). */
  findObjectOwners(name: string, kind: "table" | "view", schema?: string): Promise<SsOwnerRow[]> {
    const params: unknown[] = [name];
    const sc = this.schemaCond("s.name", params, schema);
    return this.conn.query<SsOwnerRow>(
      `SELECT s.name AS owner, o.name AS name
         FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE o.type = '${kind === "table" ? "U" : "V"}' AND LOWER(o.name) = LOWER(@p1) AND ${sc}`,
      params,
    );
  }

  /**
   * Token de frescor: `modify_date` (o SQL Server o atualiza em ALTER e em CREATE/ALTER INDEX
   * de tabela/view) + checksum dos MS_Description (comentários vão pro .ts mas NÃO mexem em
   * modify_date). Uma query só, sem privilégio especial.
   * ponytail: CHECKSUM_AGG pode colidir; basta p/ invalidar cache, não é prova criptográfica.
   */
  findObjectFreshness(name: string, schema?: string): Promise<{ owner: string; name: string; token: string }[]> {
    const params: unknown[] = [name];
    const sc = this.schemaCond("s.name", params, schema);
    return this.conn.query<{ owner: string; name: string; token: string }>(
      `SELECT s.name AS owner, o.name AS name,
              CONVERT(varchar(33), o.modify_date, 126) + ':' + CAST(ISNULL((
                SELECT CHECKSUM_AGG(CHECKSUM(CAST(ep.value AS nvarchar(4000)), ep.minor_id))
                  FROM sys.extended_properties ep
                 WHERE ep.class = 1 AND ep.major_id = o.object_id AND ep.name = 'MS_Description'
              ), 0) AS varchar(20)) AS token
         FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE o.type IN ('U', 'V') AND LOWER(o.name) = LOWER(@p1) AND ${sc}`,
      params,
    );
  }

  findViews(schema?: string, pattern?: string): Promise<SsViewRow[]> {
    const params: unknown[] = [];
    const sc = this.schemaCond("s.name", params, schema);
    let where = `v.is_ms_shipped = 0 AND ${sc}`;
    if (pattern) where += ` AND LOWER(v.name) LIKE ${this.likeParam(params, pattern)}`;
    return this.conn.query<SsViewRow>(
      `SELECT s.name AS owner, v.name AS view_name
         FROM sys.views v JOIN sys.schemas s ON s.schema_id = v.schema_id
        WHERE ${where}
        ORDER BY s.name, v.name`,
      params,
    );
  }

  /** Definição completa (CREATE VIEW ... AS SELECT ...). Vazia se criptografada/sem permissão. */
  async findViewText(owner: string, view: string): Promise<string> {
    const rows = await this.conn.query<{ text: string | null }>(
      `SELECT OBJECT_DEFINITION(v.object_id) AS text
         FROM sys.views v JOIN sys.schemas s ON s.schema_id = v.schema_id
        WHERE LOWER(s.name) = LOWER(@p1) AND LOWER(v.name) = LOWER(@p2)`,
      [owner, view],
    );
    return rows[0]?.text?.trim() ?? "";
  }

  /** Colunas de tabela ou view (sys.objects U/V), com default e MS_Description. */
  findColumns(owner: string, table: string): Promise<SsColumnRow[]> {
    return this.conn.query<SsColumnRow>(
      `SELECT c.name AS column_name, ${TYPE_NAME} AS data_type,
              CASE WHEN c.is_nullable = 1 THEN 'YES' ELSE 'NO' END AS nullable,
              CASE WHEN ${TYPE_NAME} IN ('char', 'varchar', 'binary', 'varbinary') THEN NULLIF(c.max_length, -1)
                   WHEN ${TYPE_NAME} IN ('nchar', 'nvarchar') THEN NULLIF(c.max_length, -1) / 2 END AS data_length,
              CASE WHEN ${TYPE_NAME} IN ('decimal', 'numeric') THEN c.precision END AS data_precision,
              CASE WHEN ${TYPE_NAME} IN ('decimal', 'numeric', 'datetime2', 'time', 'datetimeoffset') THEN c.scale END AS data_scale,
              dc.definition AS data_default,
              CAST(ep.value AS nvarchar(4000)) AS comments
         FROM sys.columns c
         JOIN sys.objects o ON o.object_id = c.object_id
         JOIN sys.schemas s ON s.schema_id = o.schema_id
         ${TYPE_JOINS("c")}
         LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
         LEFT JOIN sys.extended_properties ep
           ON ep.class = 1 AND ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.name = 'MS_Description'
        WHERE o.type IN ('U', 'V') AND LOWER(s.name) = LOWER(@p1) AND LOWER(o.name) = LOWER(@p2)
        ORDER BY c.column_id`,
      [owner, table],
    );
  }

  /** Comentário do objeto (MS_Description da tabela/view) — cobre tabela e view. */
  async findObjectComment(owner: string, name: string): Promise<string | null> {
    const rows = await this.conn.query<{ comments: string | null }>(
      `SELECT CAST(ep.value AS nvarchar(4000)) AS comments
         FROM sys.objects o
         JOIN sys.schemas s ON s.schema_id = o.schema_id
         LEFT JOIN sys.extended_properties ep
           ON ep.class = 1 AND ep.major_id = o.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
        WHERE o.type IN ('U', 'V') AND LOWER(s.name) = LOWER(@p1) AND LOWER(o.name) = LOWER(@p2)`,
      [owner, name],
    );
    return rows[0]?.comments?.trim() ?? null;
  }

  /** Check constraints. NOT NULL não é check no SQL Server. */
  findCheckConstraints(owner: string, table: string): Promise<SsCheckRow[]> {
    return this.conn.query<SsCheckRow>(
      `SELECT cc.name AS constraint_name, cc.definition AS search_condition
         FROM sys.check_constraints cc
         JOIN sys.objects o ON o.object_id = cc.parent_object_id
         JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE LOWER(s.name) = LOWER(@p1) AND LOWER(o.name) = LOWER(@p2)
        ORDER BY cc.name`,
      [owner, table],
    );
  }

  /** PK e UNIQUE constraints (uma linha por coluna, na ordem da chave). PK primeiro. */
  findKeyConstraints(owner: string, table: string): Promise<SsKeyRow[]> {
    return this.conn.query<SsKeyRow>(
      `SELECT i.name AS constraint_name,
              CASE WHEN i.is_primary_key = 1 THEN 'PRIMARY KEY' ELSE 'UNIQUE' END AS kind,
              c.name AS column_name
         FROM sys.indexes i
         JOIN sys.index_columns ic
           ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0 AND ic.key_ordinal > 0
         JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
         JOIN sys.objects o ON o.object_id = i.object_id
         JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE (i.is_primary_key = 1 OR i.is_unique_constraint = 1)
          AND LOWER(s.name) = LOWER(@p1) AND LOWER(o.name) = LOWER(@p2)
        ORDER BY i.is_primary_key DESC, i.name, ic.key_ordinal`,
      [owner, table],
    );
  }

  /** FKs de saída: constraints desta tabela apontando para outras. */
  findOutgoingFks(owner: string, table: string): Promise<SsFkRow[]> {
    return this.conn.query<SsFkRow>(
      `${FK_SELECT}
        WHERE LOWER(ps.name) = LOWER(@p1) AND LOWER(po.name) = LOWER(@p2)
        ORDER BY fk.name, fkc.constraint_column_id`,
      [owner, table],
    );
  }

  /** FKs de entrada: constraints de outras tabelas apontando para esta. */
  findIncomingFks(owner: string, table: string): Promise<SsFkRow[]> {
    return this.conn.query<SsFkRow>(
      `${FK_SELECT}
        WHERE LOWER(rs.name) = LOWER(@p1) AND LOWER(ro.name) = LOWER(@p2)
        ORDER BY ps.name, po.name, fk.name, fkc.constraint_column_id`,
      [owner, table],
    );
  }

  /** Todas as colunas de tabelas do schema (inventário p/ inferência de FK). */
  inventoryColumns(schema?: string): Promise<{ owner: string; table_name: string; column_name: string; data_type: string }[]> {
    const params: unknown[] = [];
    const sc = this.schemaCond("s.name", params, schema);
    return this.conn.query(
      `SELECT s.name AS owner, t.name AS table_name, c.name AS column_name, ${TYPE_NAME} AS data_type
         FROM sys.columns c
         JOIN sys.tables t ON t.object_id = c.object_id
         JOIN sys.schemas s ON s.schema_id = t.schema_id
         ${TYPE_JOINS("c")}
        WHERE t.is_ms_shipped = 0 AND ${sc}`,
      params,
    );
  }

  /** Colunas de PK ('P') ou de FK declarada ('R') do schema. */
  inventoryKeyColumns(constraintType: "P" | "R", schema?: string): Promise<{ owner: string; table_name: string; column_name: string }[]> {
    const params: unknown[] = [];
    const sc = this.schemaCond("s.name", params, schema);
    const from = constraintType === "P"
      ? `sys.indexes i
         JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
         JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
         JOIN sys.tables t ON t.object_id = i.object_id
         JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE i.is_primary_key = 1 AND`
      : `sys.foreign_key_columns fkc
         JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
         JOIN sys.tables t ON t.object_id = fkc.parent_object_id
         JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE`;
    return this.conn.query(
      `SELECT s.name AS owner, t.name AS table_name, c.name AS column_name FROM ${from} ${sc}`,
      params,
    );
  }

  findIndexes(owner: string, table: string): Promise<SsIndexRow[]> {
    return this.conn.query<SsIndexRow>(
      `SELECT i.name AS index_name,
              CASE WHEN i.is_unique = 1 THEN 'UNIQUE' ELSE 'NONUNIQUE' END AS uniqueness,
              c.name AS column_name
         FROM sys.indexes i
         JOIN sys.index_columns ic
           ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0 AND ic.key_ordinal > 0
         JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
         JOIN sys.objects o ON o.object_id = i.object_id
         JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE i.type > 0 AND i.is_hypothetical = 0
          AND LOWER(s.name) = LOWER(@p1) AND LOWER(o.name) = LOWER(@p2)
        ORDER BY i.name, ic.key_ordinal`,
      [owner, table],
    );
  }

  /** Resolve owner + tipo p/ get_ddl (tabela, view, procedure, function, trigger). */
  findObjectForDdl(name: string, schema?: string): Promise<{ owner: string; object_type: string }[]> {
    const params: unknown[] = [name];
    const sc = this.schemaCond("s.name", params, schema);
    return this.conn.query<{ owner: string; object_type: string }>(
      `SELECT s.name AS owner,
              CASE o.type WHEN 'U' THEN 'TABLE' WHEN 'V' THEN 'VIEW' WHEN 'P' THEN 'PROCEDURE'
                          WHEN 'TR' THEN 'TRIGGER' ELSE 'FUNCTION' END AS object_type
         FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE LOWER(o.name) = LOWER(@p1) AND o.type IN ${DDL_TYPES} AND o.is_ms_shipped = 0 AND ${sc}
        ORDER BY CASE o.type WHEN 'U' THEN 0 WHEN 'V' THEN 1 ELSE 2 END`,
      params,
    );
  }

  /** Colunas cruas (tipo-base + tamanho) p/ reconstruir CREATE TABLE. */
  findColumnsForDdl(owner: string, table: string): Promise<SsDdlColumnRow[]> {
    return this.conn.query<SsDdlColumnRow>(
      `SELECT c.name AS name, ${TYPE_NAME} AS data_type, c.max_length, c.precision, c.scale,
              c.is_nullable, c.is_identity,
              CAST(idc.seed_value AS bigint) AS seed, CAST(idc.increment_value AS bigint) AS incr,
              dc.definition AS [default], cmp.definition AS computed
         FROM sys.columns c
         JOIN sys.objects o ON o.object_id = c.object_id
         JOIN sys.schemas s ON s.schema_id = o.schema_id
         ${TYPE_JOINS("c")}
         LEFT JOIN sys.identity_columns idc ON idc.object_id = c.object_id AND idc.column_id = c.column_id
         LEFT JOIN sys.computed_columns cmp ON cmp.object_id = c.object_id AND cmp.column_id = c.column_id
         LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
        WHERE o.type = 'U' AND LOWER(s.name) = LOWER(@p1) AND LOWER(o.name) = LOWER(@p2)
        ORDER BY c.column_id`,
      [owner, table],
    );
  }

  /** Fonte T-SQL de view/procedure/function/trigger. Vazio se criptografado/sem VIEW DEFINITION. */
  async fetchModuleDdl(owner: string, name: string): Promise<string> {
    const rows = await this.conn.query<{ ddl: string | null }>(
      `SELECT TOP 1 OBJECT_DEFINITION(o.object_id) AS ddl
         FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE LOWER(s.name) = LOWER(@p1) AND LOWER(o.name) = LOWER(@p2) AND o.type IN ('V', 'P', 'FN', 'IF', 'TF', 'TR')`,
      [owner, name],
    );
    return rows[0]?.ddl?.trim() ?? "";
  }

  /** Procedures e functions standalone (sem CLR). */
  findRoutines(schema?: string, pattern?: string): Promise<SsRoutineRow[]> {
    const params: unknown[] = [];
    const where = this.routineFilter(params, schema, pattern);
    return this.conn.query<SsRoutineRow>(
      `SELECT s.name AS owner, o.name AS object_name,
              CASE o.type WHEN 'P' THEN 'PROCEDURE' ELSE 'FUNCTION' END AS object_type
         FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE ${where}
        ORDER BY s.name, o.name`,
      params,
    );
  }

  /** Argumentos de TODAS as rotinas do filtro numa query só (evita N+1). parameter_id 0 = retorno. */
  findArguments(schema?: string, pattern?: string): Promise<SsArgumentRow[]> {
    const params: unknown[] = [];
    const where = this.routineFilter(params, schema, pattern);
    return this.conn.query<SsArgumentRow>(
      `SELECT s.name AS owner, o.name AS object_name,
              CASE WHEN p.parameter_id = 0 THEN NULL ELSE p.name END AS argument_name,
              p.parameter_id AS position, ${TYPE_NAME} AS data_type,
              CASE WHEN p.parameter_id = 0 THEN 'OUT' WHEN p.is_output = 1 THEN 'IN/OUT' ELSE 'IN' END AS in_out
         FROM sys.parameters p
         JOIN sys.objects o ON o.object_id = p.object_id
         JOIN sys.schemas s ON s.schema_id = o.schema_id
         ${TYPE_JOINS("p")}
        WHERE ${where}
        ORDER BY s.name, o.name, p.parameter_id`,
      params,
    );
  }

  private routineFilter(params: unknown[], schema?: string, pattern?: string): string {
    let where = `o.type IN ${ROUTINE_TYPES} AND o.is_ms_shipped = 0 AND ${this.schemaCond("s.name", params, schema)}`;
    if (pattern) where += ` AND LOWER(o.name) LIKE ${this.likeParam(params, pattern)}`;
    return where;
  }

  runSql(sql: string): Promise<Record<string, unknown>[]> {
    return this.conn.query<Record<string, unknown>>(sql, []);
  }
}

// SELECT base das FKs: constraint → colunas (pai) → colunas referenciadas, por posição.
const FK_SELECT = `
  SELECT fk.name AS constraint_name,
         ps.name AS owner, po.name AS table_name, pc.name AS column_name,
         fkc.constraint_column_id AS position,
         rs.name AS r_owner, ro.name AS r_table, rc.name AS r_column
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    JOIN sys.objects po ON po.object_id = fkc.parent_object_id
    JOIN sys.schemas ps ON ps.schema_id = po.schema_id
    JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
    JOIN sys.objects ro ON ro.object_id = fkc.referenced_object_id
    JOIN sys.schemas rs ON rs.schema_id = ro.schema_id
    JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id`;
