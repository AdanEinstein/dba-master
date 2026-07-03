import type { MysqlConnection } from "./mysql-connection.js";

export interface MysqlTableRow { owner: string; table_name: string; num_rows: number | null; }
export interface MysqlColumnRow {
  column_name: string; data_type: string; nullable: string; data_length: number | null;
  data_precision: number | null; data_scale: number | null; data_default: string | null;
  comments: string | null;
}
export interface MysqlViewRow { owner: string; view_name: string; text: string; }
export interface MysqlFkRow {
  constraint_name: string; owner: string; table_name: string; column_name: string;
  position: number; r_owner: string; r_table: string; r_column: string;
}

export class MysqlQueries {
  constructor(
    private readonly conn: MysqlConnection,
    private readonly schemaFilter: string[],
  ) {}

  private schemaCond(col: string, params: unknown[], schema?: string): string {
    if (schema) {
      params.push(schema);
      return `LOWER(${col}) = LOWER(?)`;
    }
    if (this.schemaFilter.length > 0) {
      const ph = this.schemaFilter.map(() => "?").join(", ");
      params.push(...this.schemaFilter);
      return `${col} IN (${ph})`;
    }
    return `${col} NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')`;
  }

  async findTables(schema?: string, pattern?: string): Promise<MysqlTableRow[]> {
    const params: unknown[] = [];
    const sc = this.schemaCond("TABLE_SCHEMA", params, schema);
    let sql = 
      "SELECT TABLE_SCHEMA as owner, TABLE_NAME as table_name, TABLE_ROWS as num_rows " +
      "FROM information_schema.tables " +
      "WHERE TABLE_TYPE = 'BASE TABLE' AND " + sc;
    
    if (pattern) {
      sql += " AND TABLE_NAME LIKE ?";
      params.push("%" + pattern + "%");
    }
    sql += " ORDER BY TABLE_SCHEMA, TABLE_NAME";
    return this.conn.query<MysqlTableRow>(sql, params);
  }

  async findColumns(table: string, schema?: string): Promise<MysqlColumnRow[]> {
    const params: unknown[] = [table];
    const sc = this.schemaCond("TABLE_SCHEMA", params, schema);
    const sql = 
      "SELECT " +
      "  COLUMN_NAME as column_name, " +
      "  DATA_TYPE as data_type, " +
      "  IS_NULLABLE as nullable, " +
      "  CHARACTER_MAXIMUM_LENGTH as data_length, " +
      "  NUMERIC_PRECISION as data_precision, " +
      "  NUMERIC_SCALE as data_scale, " +
      "  COLUMN_DEFAULT as data_default, " +
      "  COLUMN_COMMENT as comments " +
      "FROM information_schema.columns " +
      "WHERE TABLE_NAME = ? AND " + sc + " " +
      "ORDER BY ORDINAL_POSITION";
    
    return this.conn.query<MysqlColumnRow>(sql, params);
  }

  async findViews(schema?: string, pattern?: string): Promise<MysqlViewRow[]> {
    const params: unknown[] = [];
    const sc = this.schemaCond("TABLE_SCHEMA", params, schema);
    let sql = 
      "SELECT TABLE_SCHEMA as owner, TABLE_NAME as view_name, VIEW_DEFINITION as text " +
      "FROM information_schema.views " +
      "WHERE " + sc;
    
    if (pattern) {
      sql += " AND TABLE_NAME LIKE ?";
      params.push("%" + pattern + "%");
    }
    sql += " ORDER BY TABLE_SCHEMA, TABLE_NAME";
    return this.conn.query<MysqlViewRow>(sql, params);
  }

  async findFks(table: string, schema?: string, direction: "outgoing" | "incoming" = "outgoing"): Promise<MysqlFkRow[]> {
    const params: unknown[] = [];
    let sql = 
      "SELECT " +
      "  CONSTRAINT_NAME as constraint_name, " +
      "  TABLE_SCHEMA as owner, " +
      "  TABLE_NAME as table_name, " +
      "  COLUMN_NAME as column_name, " +
      "  ORDINAL_POSITION as position, " +
      "  REFERENCED_TABLE_SCHEMA as r_owner, " +
      "  REFERENCED_TABLE_NAME as r_table, " +
      "  REFERENCED_COLUMN_NAME as r_column " +
      "FROM information_schema.KEY_COLUMN_USAGE " +
      "WHERE REFERENCED_TABLE_NAME IS NOT NULL";
    
    if (direction === "outgoing") {
      const sc = this.schemaCond("TABLE_SCHEMA", params, schema);
      sql += " AND " + sc + " AND TABLE_NAME = ?";
      params.push(table);
    } else {
      const scRef = this.schemaCond("REFERENCED_TABLE_SCHEMA", params, schema);
      sql += " AND " + scRef + " AND REFERENCED_TABLE_NAME = ?";
      params.push(table);
    }
    sql += " ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION";
    return this.conn.query<MysqlFkRow>(sql, params);
  }
  async findPrimaryKey(table: string, schema?: string): Promise<{ column_name: string }[]> {
    const params: unknown[] = [table];
    const sc = this.schemaCond("TABLE_SCHEMA", params, schema);
    const sql = `SELECT COLUMN_NAME as column_name FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_NAME = 'PRIMARY' AND TABLE_NAME = ? AND ${sc} ORDER BY ORDINAL_POSITION`;
    return this.conn.query<{ column_name: string }>(sql, params);
  }

  async findIndexes(table: string, schema?: string): Promise<{ index_name: string, column_name: string, non_unique: number }[]> {
    const params: unknown[] = [table];
    const sc = this.schemaCond("TABLE_SCHEMA", params, schema);
    const sql = `SELECT INDEX_NAME as index_name, COLUMN_NAME as column_name, NON_UNIQUE as non_unique FROM information_schema.STATISTICS WHERE TABLE_NAME = ? AND INDEX_NAME != 'PRIMARY' AND ${sc} ORDER BY INDEX_NAME, SEQ_IN_INDEX`;
    return this.conn.query<{ index_name: string, column_name: string, non_unique: number }>(sql, params);
  }

  async findCheckConstraints(table: string, schema?: string): Promise<{ constraint_name: string, check_clause: string }[]> {
    const params: unknown[] = [table];
    const sc = this.schemaCond("tc.TABLE_SCHEMA", params, schema);
    const sql = `
      SELECT cc.CONSTRAINT_NAME as constraint_name, cc.CHECK_CLAUSE as check_clause
      FROM information_schema.CHECK_CONSTRAINTS cc
      JOIN information_schema.TABLE_CONSTRAINTS tc 
        ON cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND cc.CONSTRAINT_SCHEMA = tc.TABLE_SCHEMA
      WHERE tc.TABLE_NAME = ? AND ${sc}
    `;
    try {
      return await this.conn.query<{ constraint_name: string, check_clause: string }>(sql, params);
    } catch {
      return [];
    }
  }

  async inventoryColumns(schema?: string): Promise<{ owner: string, table_name: string, column_name: string, data_type: string }[]> {
    const params: unknown[] = [];
    const sc = this.schemaCond("TABLE_SCHEMA", params, schema);
    const sql = `SELECT TABLE_SCHEMA as owner, TABLE_NAME as table_name, COLUMN_NAME as column_name, DATA_TYPE as data_type FROM information_schema.columns WHERE ${sc}`;
    return this.conn.query<{ owner: string, table_name: string, column_name: string, data_type: string }>(sql, params);
  }

  async inventoryKeyColumns(type: "PRIMARY KEY" | "FOREIGN KEY", schema?: string): Promise<{ owner: string, table_name: string, column_name: string }[]> {
    const params: unknown[] = [];
    const sc = this.schemaCond("tc.TABLE_SCHEMA", params, schema);
    const sql = `
      SELECT kcu.TABLE_SCHEMA as owner, kcu.TABLE_NAME as table_name, kcu.COLUMN_NAME as column_name
      FROM information_schema.KEY_COLUMN_USAGE kcu
      JOIN information_schema.TABLE_CONSTRAINTS tc
        ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA
      WHERE tc.CONSTRAINT_TYPE = '${type}' AND ${sc}
    `;
    return this.conn.query<{ owner: string, table_name: string, column_name: string }>(sql, params);
  }
}
