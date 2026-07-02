import type { PgConnection } from "./pg-connection.js";

// Acesso a dados do Postgres: SQL contra information_schema e pg_catalog.
// Retorna linhas cruas (colunas em minúsculo, via alias); a transformação em DTO
// fica no provider. Owner = schema. Nomes são casados case-insensitive (lower()).

export interface PgTableRow { owner: string; table_name: string; num_rows: string | number | null }
export interface PgViewRow { owner: string; view_name: string }
export interface PgOwnerRow { owner: string; name: string }
export interface PgColumnRow {
  column_name: string; data_type: string; nullable: string; data_length: number | null;
  data_precision: number | null; data_scale: number | null; data_default: string | null;
  comments: string | null;
}
export interface PgCheckRow { constraint_name: string; search_condition: string | null }
export interface PgFkRow {
  constraint_name: string; owner: string; table_name: string; column_name: string;
  position: number; r_owner: string; r_table: string; r_column: string;
}
export interface PgIndexRow { index_name: string; uniqueness: string; column_name: string }
export interface PgRoutineRow { owner: string; object_name: string; object_type: string }
export interface PgArgumentRow {
  argument_name: string | null; position: number; data_type: string | null; in_out: string;
}
export interface PgDdlColumnRow { name: string; type: string; not_null: boolean; default: string | null }
export interface PgConstraintDefRow { name: string; def: string; contype: string }

export class PgQueries {
  constructor(
    private readonly conn: PgConnection,
    private readonly schemaFilter: string[],
  ) {}

  /**
   * Restringe as consultas aos schemas alvo. Sem schema e sem schemaFilter,
   * exclui os schemas de sistema (information_schema e os pg_*).
   * Empurra os binds em `params` e devolve o fragmento SQL.
   */
  private schemaCond(col: string, params: unknown[], schema?: string): string {
    if (schema) {
      params.push(schema);
      return `lower(${col}) = lower($${params.length})`;
    }
    if (this.schemaFilter.length) {
      const ph = this.schemaFilter.map((s) => {
        params.push(s);
        return `$${params.length}`;
      }).join(", ");
      return `${col} IN (${ph})`;
    }
    return `${col} <> 'information_schema' AND ${col} !~ '^pg_'`;
  }

  findTables(schema?: string, pattern?: string): Promise<PgTableRow[]> {
    const params: unknown[] = [];
    const sc = this.schemaCond("n.nspname", params, schema);
    let where = `c.relkind IN ('r','p') AND ${sc}`;
    if (pattern) {
      params.push(`%${pattern}%`);
      where += ` AND c.relname ILIKE $${params.length}`;
    }
    return this.conn.query<PgTableRow>(
      `SELECT n.nspname AS owner, c.relname AS table_name, c.reltuples::bigint AS num_rows
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE ${where}
        ORDER BY n.nspname, c.relname`,
      params,
    );
  }

  /** Resolve owner + nome canônico de um objeto por relkind (tabela/view). */
  findObjectOwners(name: string, relkinds: string[], schema?: string): Promise<PgOwnerRow[]> {
    const params: unknown[] = [];
    const kinds = relkinds.map((k) => {
      params.push(k);
      return `$${params.length}`;
    }).join(", ");
    params.push(name);
    const nameIdx = params.length;
    const sc = this.schemaCond("n.nspname", params, schema);
    return this.conn.query<PgOwnerRow>(
      `SELECT n.nspname AS owner, c.relname AS name
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN (${kinds}) AND lower(c.relname) = lower($${nameIdx}) AND ${sc}`,
      params,
    );
  }

  findViews(schema?: string, pattern?: string): Promise<PgViewRow[]> {
    const params: unknown[] = [];
    const sc = this.schemaCond("n.nspname", params, schema);
    let where = `c.relkind IN ('v','m') AND ${sc}`;
    if (pattern) {
      params.push(`%${pattern}%`);
      where += ` AND c.relname ILIKE $${params.length}`;
    }
    return this.conn.query<PgViewRow>(
      `SELECT n.nspname AS owner, c.relname AS view_name
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE ${where}
        ORDER BY n.nspname, c.relname`,
      params,
    );
  }

  async findViewText(owner: string, view: string): Promise<string> {
    const rows = await this.conn.query<{ text: string | null }>(
      `SELECT pg_get_viewdef(c.oid, true) AS text
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE lower(n.nspname) = lower($1) AND lower(c.relname) = lower($2)
          AND c.relkind IN ('v','m')`,
      [owner, view],
    );
    return rows[0]?.text?.trim() ?? "";
  }

  findColumns(owner: string, table: string): Promise<PgColumnRow[]> {
    return this.conn.query<PgColumnRow>(
      `SELECT c.column_name, c.data_type, c.is_nullable AS nullable,
              c.character_maximum_length AS data_length,
              c.numeric_precision AS data_precision, c.numeric_scale AS data_scale,
              c.column_default AS data_default, d.description AS comments
         FROM information_schema.columns c
         JOIN pg_catalog.pg_namespace pn ON pn.nspname = c.table_schema
         JOIN pg_catalog.pg_class pc ON pc.relname = c.table_name AND pc.relnamespace = pn.oid
         LEFT JOIN pg_catalog.pg_description d ON d.objoid = pc.oid AND d.objsubid = c.ordinal_position
        WHERE lower(c.table_schema) = lower($1) AND lower(c.table_name) = lower($2)
        ORDER BY c.ordinal_position`,
      [owner, table],
    );
  }

  /** Comentário do objeto (COMMENT ON TABLE/VIEW) — cobre tabela e view. */
  async findObjectComment(owner: string, name: string): Promise<string | null> {
    const rows = await this.conn.query<{ comments: string | null }>(
      `SELECT d.description AS comments
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = 0
        WHERE lower(n.nspname) = lower($1) AND lower(c.relname) = lower($2)`,
      [owner, name],
    );
    return rows[0]?.comments?.trim() ?? null;
  }

  /** Check constraints (contype 'c'). Postgres não modela NOT NULL como check. */
  findCheckConstraints(owner: string, table: string): Promise<PgCheckRow[]> {
    return this.conn.query<PgCheckRow>(
      `SELECT con.conname AS constraint_name, pg_get_constraintdef(con.oid) AS search_condition
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE con.contype = 'c' AND lower(n.nspname) = lower($1) AND lower(c.relname) = lower($2)
        ORDER BY con.conname`,
      [owner, table],
    );
  }

  findPrimaryKey(owner: string, table: string): Promise<{ column_name: string }[]> {
    return this.conn.query<{ column_name: string }>(
      `SELECT a.attname AS column_name
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
        WHERE con.contype = 'p' AND lower(n.nspname) = lower($1) AND lower(c.relname) = lower($2)
        ORDER BY k.ord`,
      [owner, table],
    );
  }

  /** FKs de saída: constraints 'f' desta tabela apontando para outras. */
  findOutgoingFks(owner: string, table: string): Promise<PgFkRow[]> {
    return this.conn.query<PgFkRow>(
      `${FK_SELECT}
        WHERE con.contype = 'f' AND lower(n.nspname) = lower($1) AND lower(c.relname) = lower($2)
        ORDER BY con.conname, k.ord`,
      [owner, table],
    );
  }

  /** FKs de entrada: constraints 'f' de outras tabelas apontando para esta. */
  findIncomingFks(owner: string, table: string): Promise<PgFkRow[]> {
    return this.conn.query<PgFkRow>(
      `${FK_SELECT}
        WHERE con.contype = 'f' AND lower(rn.nspname) = lower($1) AND lower(rc.relname) = lower($2)
        ORDER BY n.nspname, c.relname, con.conname, k.ord`,
      [owner, table],
    );
  }

  /** Todas as colunas de tabelas base do schema (inventário p/ inferência de FK). */
  inventoryColumns(schema?: string): Promise<{ owner: string; table_name: string; column_name: string; data_type: string }[]> {
    const params: unknown[] = [];
    const sc = this.schemaCond("c.table_schema", params, schema);
    return this.conn.query(
      `SELECT c.table_schema AS owner, c.table_name, c.column_name, c.data_type
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
          AND t.table_type = 'BASE TABLE'
        WHERE ${sc}`,
      params,
    );
  }

  /** Colunas de PK ('P' → contype 'p') ou FK declarada ('R' → contype 'f') do schema. */
  inventoryKeyColumns(constraintType: "P" | "R", schema?: string): Promise<{ owner: string; table_name: string; column_name: string }[]> {
    const contype = constraintType === "P" ? "p" : "f";
    const params: unknown[] = [contype];
    const sc = this.schemaCond("n.nspname", params, schema);
    return this.conn.query(
      `SELECT n.nspname AS owner, c.relname AS table_name, a.attname AS column_name
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN unnest(con.conkey) AS k(attnum) ON true
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
        WHERE con.contype = $1 AND ${sc}`,
      params,
    );
  }

  findIndexes(owner: string, table: string): Promise<PgIndexRow[]> {
    return this.conn.query<PgIndexRow>(
      `SELECT ic.relname AS index_name,
              CASE WHEN ix.indisunique THEN 'UNIQUE' ELSE 'NONUNIQUE' END AS uniqueness,
              a.attname AS column_name
         FROM pg_index ix
         JOIN pg_class c ON c.oid = ix.indrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_class ic ON ic.oid = ix.indexrelid
         JOIN unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
        WHERE lower(n.nspname) = lower($1) AND lower(c.relname) = lower($2) AND k.attnum <> 0
        ORDER BY ic.relname, k.ord`,
      [owner, table],
    );
  }

  /** Resolve owner + tipo p/ get_ddl. Cobre relações (pg_class) e rotinas (pg_proc). */
  findObjectForDdl(name: string, schema?: string): Promise<{ owner: string; object_type: string }[]> {
    const params: unknown[] = [];
    params.push(name);
    const n1 = params.length;
    const sc1 = this.schemaCond("n.nspname", params, schema);
    params.push(name);
    const n2 = params.length;
    const sc2 = this.schemaCond("n.nspname", params, schema);
    return this.conn.query<{ owner: string; object_type: string }>(
      `SELECT owner, object_type FROM (
         SELECT n.nspname AS owner,
                CASE c.relkind WHEN 'r' THEN 'TABLE' WHEN 'p' THEN 'TABLE' WHEN 'v' THEN 'VIEW'
                               WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE' END AS object_type
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE lower(c.relname) = lower($${n1}) AND c.relkind IN ('r','p','v','m','S') AND ${sc1}
         UNION ALL
         SELECT n.nspname AS owner,
                CASE p.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END AS object_type
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE lower(p.proname) = lower($${n2}) AND p.prokind IN ('f','p') AND ${sc2}
       ) x
       ORDER BY CASE object_type WHEN 'TABLE' THEN 0 WHEN 'VIEW' THEN 1 ELSE 2 END`,
      params,
    );
  }

  /** Colunas cruas (com tipo formatado) p/ reconstruir CREATE TABLE. */
  findColumnsForDdl(owner: string, table: string): Promise<PgDdlColumnRow[]> {
    return this.conn.query<PgDdlColumnRow>(
      `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
              a.attnotnull AS not_null, pg_get_expr(ad.adbin, ad.adrelid) AS "default"
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
        WHERE lower(n.nspname) = lower($1) AND lower(c.relname) = lower($2)
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
      [owner, table],
    );
  }

  /** Definições de constraints (PK/UNIQUE/FK/CHECK) p/ o CREATE TABLE. */
  findConstraintDefs(owner: string, table: string): Promise<PgConstraintDefRow[]> {
    return this.conn.query<PgConstraintDefRow>(
      `SELECT con.conname AS name, pg_get_constraintdef(con.oid) AS def, con.contype::text AS contype
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE lower(n.nspname) = lower($1) AND lower(c.relname) = lower($2)
        ORDER BY CASE con.contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'f' THEN 2 ELSE 3 END, con.conname`,
      [owner, table],
    );
  }

  async fetchFunctionDdl(owner: string, name: string): Promise<string> {
    const rows = await this.conn.query<{ ddl: string }>(
      `SELECT pg_get_functiondef(p.oid) AS ddl
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE lower(n.nspname) = lower($1) AND lower(p.proname) = lower($2)
          AND p.prokind IN ('f','p')
        LIMIT 1`,
      [owner, name],
    );
    return rows[0]?.ddl?.trim() ?? "";
  }

  /** Procedures e functions standalone (pg_proc). Ignora aggregate/window. */
  findRoutines(schema?: string, pattern?: string): Promise<PgRoutineRow[]> {
    const params: unknown[] = [];
    const sc = this.schemaCond("n.nspname", params, schema);
    let where = `p.prokind IN ('f','p') AND ${sc}`;
    if (pattern) {
      params.push(`%${pattern}%`);
      where += ` AND p.proname ILIKE $${params.length}`;
    }
    return this.conn.query<PgRoutineRow>(
      `SELECT n.nspname AS owner, p.proname AS object_name,
              CASE p.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END AS object_type
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE ${where}
        ORDER BY n.nspname, p.proname`,
      params,
    );
  }

  /**
   * Argumentos via information_schema.parameters (specific_name = proname_oid).
   * ponytail: casa por nome, então em rotinas sobrecarregadas os argumentos das
   * variações aparecem juntos — raro; refinar por oid se necessário.
   */
  findArguments(owner: string, objectName: string): Promise<PgArgumentRow[]> {
    return this.conn.query<PgArgumentRow>(
      `SELECT par.parameter_name AS argument_name, par.ordinal_position AS position,
              par.data_type, upper(par.parameter_mode) AS in_out
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         JOIN information_schema.parameters par
           ON par.specific_schema = n.nspname AND par.specific_name = p.proname || '_' || p.oid
        WHERE lower(n.nspname) = lower($1) AND lower(p.proname) = lower($2)
        ORDER BY par.ordinal_position`,
      [owner, objectName],
    );
  }

  runSql(sql: string): Promise<Record<string, unknown>[]> {
    return this.conn.query<Record<string, unknown>>(sql, []);
  }
}

// SELECT base das FKs: junta constraint → colunas (conkey) → colunas referenciadas
// (confkey), casando por posição via ORDINALITY.
const FK_SELECT = `
  SELECT con.conname AS constraint_name,
         n.nspname AS owner, c.relname AS table_name,
         att.attname AS column_name, k.ord AS position,
         rn.nspname AS r_owner, rc.relname AS r_table, ratt.attname AS r_column
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_class rc ON rc.oid = con.confrelid
    JOIN pg_namespace rn ON rn.oid = rc.relnamespace
    JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum = k.attnum
    JOIN unnest(con.confkey) WITH ORDINALITY AS rk(attnum, ord) ON rk.ord = k.ord
    JOIN pg_attribute ratt ON ratt.attrelid = rc.oid AND ratt.attnum = rk.attnum`;
