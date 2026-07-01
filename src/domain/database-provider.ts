import type {
  TableRef,
  TableSchema,
  ViewRef,
  ViewSchema,
  Relationships,
  DdlResult,
  ProcedureRef,
  PackageRef,
  ScheduledJob,
  RunSqlResult,
} from "./types.js";

// PORT (hexagonal): contrato que todo banco deve implementar. Tools e domínio
// dependem só desta interface — nunca de um driver ou dialeto SQL concreto.

/** Recursos opcionais que variam entre bancos (ex.: Postgres não tem packages). */
export interface Capabilities {
  packages: boolean;
  scheduledJobs: boolean;
}

export interface DatabaseProvider {
  /** Identificador do engine, ex.: "oracle". */
  readonly engine: string;
  /** O que este banco suporta. Tools consultam antes de expor um recurso. */
  readonly capabilities: Capabilities;

  /** Mapeia um tipo nativo do banco para o tipo TypeScript equivalente. */
  typeToTs(dataType: string): string;

  listTables(schema?: string): Promise<TableRef[]>;
  searchTables(pattern: string, schema?: string): Promise<TableRef[]>;
  /** last_ddl_time de todas as tabelas/views do schema, em UMA query (fast-path do cache incremental). */
  listDdlTimes(schema?: string): Promise<{ owner: string; name: string; lastDdlTime: string }[]>;
  /** Descreve a tabela (sem gerar cache — isso é responsabilidade da tool). */
  describeTable(table: string, schema?: string): Promise<TableSchema>;
  getRelationships(table: string, schema?: string): Promise<Relationships>;
  /** Lista views (owner, nome), opcionalmente filtrando por substring do nome. */
  listViews(schema?: string, pattern?: string): Promise<ViewRef[]>;
  /** Descreve a view: colunas + o SELECT que a define. */
  describeView(view: string, schema?: string): Promise<ViewSchema>;
  getDdl(name: string, schema?: string, objectType?: string): Promise<DdlResult>;
  listProcedures(schema?: string, pattern?: string): Promise<ProcedureRef[]>;
  listPackages(schema?: string, pattern?: string): Promise<PackageRef[]>;
  listScheduledJobs(schema?: string, pattern?: string): Promise<ScheduledJob[]>;
  /** Executa SQL cru, sem guarda de escrita (a política read-only fica na tool). */
  runSql(sql: string, maxRows?: number): Promise<RunSqlResult>;

  close(): Promise<void>;
}
