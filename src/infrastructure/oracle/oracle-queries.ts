import type { OracleConnection } from "./oracle-connection.js";

// Acesso a dados do Oracle: todo SQL contra as views ALL_* e DBMS_METADATA.
// Retorna linhas cruas (colunas em MAIÚSCULO); a transformação em DTO fica no provider.

export interface TableRow { OWNER: string; TABLE_NAME: string; NUM_ROWS: number | null }
export interface ViewRow { OWNER: string; VIEW_NAME: string }
export interface ColumnRow {
  COLUMN_NAME: string; DATA_TYPE: string; NULLABLE: string; DATA_LENGTH: number;
  DATA_PRECISION: number | null; DATA_SCALE: number | null; DATA_DEFAULT: string | null;
  COMMENTS: string | null;
}
export interface CheckRow { CONSTRAINT_NAME: string; SEARCH_CONDITION: string | null }
export interface FkRow {
  CONSTRAINT_NAME: string; OWNER: string; TABLE_NAME: string; COLUMN_NAME: string;
  POSITION: number; R_OWNER: string; R_TABLE: string; R_COLUMN: string;
}
export interface IndexRow { INDEX_NAME: string; UNIQUENESS: string; COLUMN_NAME: string }
export interface RoutineRow { OWNER: string; OBJECT_NAME: string; OBJECT_TYPE: string }
export interface ArgumentRow {
  ARGUMENT_NAME: string | null; POSITION: number; DATA_TYPE: string | null; IN_OUT: string;
}
export interface JobRow {
  OWNER: string; JOB_NAME: string; JOB_STYLE: string | null; JOB_TYPE: string | null;
  JOB_ACTION: string | null; SCHEDULE_TYPE: string | null; REPEAT_INTERVAL: string | null;
  ENABLED: string; STATE: string | null; LAST_START_DATE: Date | null;
  NEXT_RUN_DATE: Date | null; COMMENTS: string | null;
}

export class OracleQueries {
  constructor(
    private readonly conn: OracleConnection,
    private readonly schemaFilter: string[],
  ) {}

  /**
   * Restringe as views ALL_* aos schemas alvo.
   * Sem schema e sem SCHEMA_FILTER: exclui schemas mantidos pela Oracle via ALL_USERS.
   */
  private ownerClause(alias: string, schema?: string): { sql: string; binds: Record<string, unknown> } {
    if (schema) {
      return { sql: `${alias}.owner = :owner`, binds: { owner: schema.toUpperCase() } };
    }
    const filter = this.schemaFilter;
    if (filter.length) {
      const names = filter.map((_, i) => `:s${i}`).join(", ");
      const binds: Record<string, unknown> = {};
      filter.forEach((s, i) => (binds[`s${i}`] = s));
      return { sql: `${alias}.owner IN (${names})`, binds };
    }
    return {
      sql: `${alias}.owner IN (SELECT username FROM all_users WHERE oracle_maintained = 'N')`,
      binds: {},
    };
  }

  findTables(schema?: string, pattern?: string): Promise<TableRow[]> {
    const oc = this.ownerClause("t", schema);
    return this.conn.query<TableRow>(
      `SELECT t.owner, t.table_name, t.num_rows
         FROM all_tables t
        WHERE ${oc.sql}
          ${pattern ? "AND UPPER(t.table_name) LIKE UPPER(:pat)" : ""}
        ORDER BY t.owner, t.table_name`,
      pattern ? { ...oc.binds, pat: `%${pattern}%` } : oc.binds,
    );
  }

  findTableOwners(table: string): Promise<{ OWNER: string }[]> {
    const oc = this.ownerClause("t");
    return this.conn.query<{ OWNER: string }>(
      `SELECT t.owner FROM all_tables t
        WHERE ${oc.sql} AND UPPER(t.table_name) = UPPER(:tab)`,
      { ...oc.binds, tab: table },
    );
  }

  findViews(schema?: string, pattern?: string): Promise<ViewRow[]> {
    const oc = this.ownerClause("v", schema);
    return this.conn.query<ViewRow>(
      `SELECT v.owner, v.view_name
         FROM all_views v
        WHERE ${oc.sql}
          ${pattern ? "AND UPPER(v.view_name) LIKE UPPER(:pat)" : ""}
        ORDER BY v.owner, v.view_name`,
      pattern ? { ...oc.binds, pat: `%${pattern}%` } : oc.binds,
    );
  }

  findViewOwners(view: string): Promise<{ OWNER: string }[]> {
    const oc = this.ownerClause("v");
    return this.conn.query<{ OWNER: string }>(
      `SELECT v.owner FROM all_views v
        WHERE ${oc.sql} AND UPPER(v.view_name) = UPPER(:vw)`,
      { ...oc.binds, vw: view },
    );
  }

  async findViewText(owner: string, view: string): Promise<string> {
    // ALL_VIEWS.TEXT é LONG; node-oracledb o retorna como string por padrão.
    const rows = await this.conn.query<{ TEXT: string | null }>(
      `SELECT text FROM all_views WHERE owner = :owner AND view_name = :vw`,
      { owner, vw: view },
    );
    return rows[0]?.TEXT?.trim() ?? "";
  }

  findColumns(owner: string, table: string): Promise<ColumnRow[]> {
    return this.conn.query<ColumnRow>(
      `SELECT c.column_name, c.data_type, c.nullable, c.data_length,
              c.data_precision, c.data_scale, c.data_default, cc.comments
         FROM all_tab_columns c
         LEFT JOIN all_col_comments cc
           ON cc.owner = c.owner AND cc.table_name = c.table_name AND cc.column_name = c.column_name
        WHERE c.owner = :owner AND c.table_name = :tab
        ORDER BY c.column_id`,
      { owner, tab: table },
    );
  }

  /** Comentário do objeto (COMMENT ON TABLE/VIEW) — cobre tabela e view. */
  async findObjectComment(owner: string, name: string): Promise<string | null> {
    const rows = await this.conn.query<{ COMMENTS: string | null }>(
      `SELECT comments FROM all_tab_comments WHERE owner = :owner AND table_name = :n`,
      { owner, n: name },
    );
    return rows[0]?.COMMENTS?.trim() ?? null;
  }

  /** Check constraints (type 'C'). O provider filtra os NOT NULL automáticos. */
  findCheckConstraints(owner: string, table: string): Promise<CheckRow[]> {
    return this.conn.query<CheckRow>(
      `SELECT constraint_name, search_condition
         FROM all_constraints
        WHERE owner = :owner AND table_name = :tab AND constraint_type = 'C'
        ORDER BY constraint_name`,
      { owner, tab: table },
    );
  }

  findPrimaryKey(owner: string, table: string): Promise<{ COLUMN_NAME: string }[]> {
    return this.conn.query<{ COLUMN_NAME: string }>(
      `SELECT cc.column_name
         FROM all_constraints c
         JOIN all_cons_columns cc
           ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name
        WHERE c.owner = :owner AND c.table_name = :tab AND c.constraint_type = 'P'
        ORDER BY cc.position`,
      { owner, tab: table },
    );
  }

  /** FKs de saída: constraints 'R' desta tabela apontando para outras. */
  findOutgoingFks(owner: string, table: string): Promise<FkRow[]> {
    return this.conn.query<FkRow>(
      `SELECT c.constraint_name, c.owner, c.table_name,
              cc.column_name, cc.position,
              rc.owner AS r_owner, rc.table_name AS r_table, rcc.column_name AS r_column
         FROM all_constraints c
         JOIN all_cons_columns cc
           ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name
         JOIN all_constraints rc
           ON rc.owner = c.r_owner AND rc.constraint_name = c.r_constraint_name
         JOIN all_cons_columns rcc
           ON rcc.owner = rc.owner AND rcc.constraint_name = rc.constraint_name
          AND rcc.position = cc.position
        WHERE c.owner = :owner AND c.table_name = :tab AND c.constraint_type = 'R'
        ORDER BY c.constraint_name, cc.position`,
      { owner, tab: table },
    );
  }

  /** FKs de entrada: constraints 'R' de outras tabelas apontando para esta. */
  findIncomingFks(owner: string, table: string): Promise<FkRow[]> {
    return this.conn.query<FkRow>(
      `SELECT c.constraint_name, c.owner, c.table_name,
              cc.column_name, cc.position,
              rc.owner AS r_owner, rc.table_name AS r_table, rcc.column_name AS r_column
         FROM all_constraints c
         JOIN all_cons_columns cc
           ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name
         JOIN all_constraints rc
           ON rc.owner = c.r_owner AND rc.constraint_name = c.r_constraint_name
         JOIN all_cons_columns rcc
           ON rcc.owner = rc.owner AND rcc.constraint_name = rc.constraint_name
          AND rcc.position = cc.position
        WHERE c.constraint_type = 'R'
          AND rc.owner = :owner AND rc.table_name = :tab
        ORDER BY c.owner, c.table_name, c.constraint_name, cc.position`,
      { owner, tab: table },
    );
  }

  /** Todas as colunas do schema (inventário p/ inferência de FK implícita). */
  inventoryColumns(schema?: string): Promise<{ OWNER: string; TABLE_NAME: string; COLUMN_NAME: string; DATA_TYPE: string }[]> {
    const oc = this.ownerClause("c", schema);
    return this.conn.query(
      `SELECT c.owner, c.table_name, c.column_name, c.data_type
         FROM all_tab_columns c
        WHERE ${oc.sql}`,
      oc.binds,
    );
  }

  /** Colunas de PK (type 'P') e FK declarada (type 'R') do schema, conforme constraintType. */
  inventoryKeyColumns(constraintType: "P" | "R", schema?: string): Promise<{ OWNER: string; TABLE_NAME: string; COLUMN_NAME: string }[]> {
    const oc = this.ownerClause("c", schema);
    return this.conn.query(
      `SELECT c.owner, c.table_name, cc.column_name
         FROM all_constraints c
         JOIN all_cons_columns cc
           ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name
        WHERE ${oc.sql} AND c.constraint_type = :ctype`,
      { ...oc.binds, ctype: constraintType },
    );
  }

  findIndexes(owner: string, table: string): Promise<IndexRow[]> {
    return this.conn.query<IndexRow>(
      `SELECT i.index_name, i.uniqueness, ic.column_name
         FROM all_indexes i
         JOIN all_ind_columns ic
           ON ic.index_owner = i.owner AND ic.index_name = i.index_name
        WHERE i.table_owner = :owner AND i.table_name = :tab
        ORDER BY i.index_name, ic.column_position`,
      { owner, tab: table },
    );
  }

  async findLastDdlTime(owner: string, name: string, objectType = "TABLE"): Promise<string | undefined> {
    const rows = await this.conn.query<{ LAST_DDL_TIME: Date }>(
      `SELECT last_ddl_time FROM all_objects
        WHERE owner = :owner AND object_name = :tab AND object_type = :otype`,
      { owner, tab: name, otype: objectType },
    );
    return rows[0]?.LAST_DDL_TIME?.toISOString();
  }

  findObjectFreshness(name: string, schema?: string): Promise<{ OWNER: string; OBJECT_NAME: string; LAST_DDL_TIME: Date }[]> {
    const oc = this.ownerClause("o", schema);
    return this.conn.query<{ OWNER: string; OBJECT_NAME: string; LAST_DDL_TIME: Date }>(
      `SELECT o.owner, o.object_name, o.last_ddl_time
         FROM all_objects o
        WHERE ${oc.sql} AND o.object_name = :obj AND o.object_type IN ('TABLE', 'VIEW')`,
      { ...oc.binds, obj: name.toUpperCase() },
    );
  }

  findDdlTimes(schema?: string): Promise<{ OWNER: string; OBJECT_NAME: string; LAST_DDL_TIME: Date }[]> {
    const oc = this.ownerClause("o", schema);
    return this.conn.query<{ OWNER: string; OBJECT_NAME: string; LAST_DDL_TIME: Date }>(
      `SELECT o.owner, o.object_name, o.last_ddl_time
         FROM all_objects o
        WHERE ${oc.sql} AND o.object_type IN ('TABLE', 'VIEW')`,
      oc.binds
    );
  }

  findObjectForDdl(name: string, schema?: string): Promise<{ OWNER: string; OBJECT_TYPE: string }[]> {
    const oc = this.ownerClause("o", schema);
    return this.conn.query<{ OWNER: string; OBJECT_TYPE: string }>(
      `SELECT o.owner, o.object_type
         FROM all_objects o
        WHERE ${oc.sql} AND o.object_name = :obj
          AND o.object_type IN ('TABLE','VIEW','PROCEDURE','FUNCTION','PACKAGE','PACKAGE BODY','TRIGGER','SEQUENCE','TYPE','MATERIALIZED VIEW')
        ORDER BY CASE o.object_type WHEN 'PACKAGE' THEN 0 ELSE 1 END`,
      { ...oc.binds, obj: name },
    );
  }

  async fetchDdl(metaType: string, name: string, owner: string): Promise<string> {
    const rows = await this.conn.query<{ DDL: string }>(
      `SELECT DBMS_METADATA.GET_DDL(:type, :name, :owner) AS ddl FROM dual`,
      { type: metaType, name, owner },
    );
    return rows[0]?.DDL?.trim() ?? "";
  }

  findRoutines(schema?: string, pattern?: string): Promise<RoutineRow[]> {
    const oc = this.ownerClause("o", schema);
    return this.conn.query<RoutineRow>(
      `SELECT o.owner, o.object_name, o.object_type
         FROM all_objects o
        WHERE ${oc.sql}
          AND o.object_type IN ('PROCEDURE','FUNCTION')
          ${pattern ? "AND UPPER(o.object_name) LIKE UPPER(:pat)" : ""}
        ORDER BY o.owner, o.object_name`,
      pattern ? { ...oc.binds, pat: `%${pattern}%` } : oc.binds,
    );
  }

  findPackages(schema?: string, pattern?: string): Promise<{ OWNER: string; OBJECT_NAME: string }[]> {
    const oc = this.ownerClause("o", schema);
    return this.conn.query<{ OWNER: string; OBJECT_NAME: string }>(
      `SELECT o.owner, o.object_name
         FROM all_objects o
        WHERE ${oc.sql}
          AND o.object_type = 'PACKAGE'
          ${pattern ? "AND UPPER(o.object_name) LIKE UPPER(:pat)" : ""}
        ORDER BY o.owner, o.object_name`,
      pattern ? { ...oc.binds, pat: `%${pattern}%` } : oc.binds,
    );
  }

  findPackageSubprograms(owner: string, pkg: string): Promise<{ PROCEDURE_NAME: string }[]> {
    return this.conn.query<{ PROCEDURE_NAME: string }>(
      `SELECT DISTINCT procedure_name
         FROM all_procedures
        WHERE owner = :owner AND object_name = :pkg AND procedure_name IS NOT NULL
        ORDER BY procedure_name`,
      { owner, pkg },
    );
  }

  findArguments(owner: string, objectName: string, packageName: string | null): Promise<ArgumentRow[]> {
    return this.conn.query<ArgumentRow>(
      `SELECT argument_name, position, data_type, in_out
         FROM all_arguments
        WHERE owner = :owner
          AND object_name = :obj
          AND ${packageName ? "package_name = :pkg" : "package_name IS NULL"}
          AND data_level = 0
        ORDER BY position`,
      packageName ? { owner, obj: objectName, pkg: packageName } : { owner, obj: objectName },
    );
  }

  findSchedulerJobs(schema?: string, pattern?: string): Promise<JobRow[]> {
    const oc = this.ownerClause("j", schema);
    return this.conn.query<JobRow>(
      `SELECT j.owner, j.job_name, j.job_style, j.job_type, j.job_action,
              j.schedule_type, j.repeat_interval, j.enabled, j.state,
              j.last_start_date, j.next_run_date, j.comments
         FROM all_scheduler_jobs j
        WHERE ${oc.sql}
          ${pattern ? "AND UPPER(j.job_name) LIKE UPPER(:pat)" : ""}
        ORDER BY j.owner, j.job_name`,
      pattern ? { ...oc.binds, pat: `%${pattern}%` } : oc.binds,
    );
  }

  runSql(sql: string, maxRows: number): Promise<Record<string, unknown>[]> {
    return this.conn.query<Record<string, unknown>>(sql, {}, { maxRows });
  }
}
