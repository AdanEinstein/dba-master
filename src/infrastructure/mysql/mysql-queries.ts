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
}
