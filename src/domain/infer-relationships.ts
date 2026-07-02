import type { SchemaInventory, SchemaKeyColumn, ImpliedRelationship } from "./types.js";

// Lógica pura, DB-agnóstica: detecta FK implícita por convenção de nome, para bancos
// legados que não declaram constraints. Só considera PKs de coluna única (o alvo típico).
// ponytail: heurística por nome; não infere composta nem lê dados. Se precisar de mais
// precisão, cruzar com amostragem de valores em run_sql.

const norm = (owner: string, table: string, col?: string) =>
  col ? `${owner}|${table}|${col}`.toUpperCase() : `${owner}|${table}`.toUpperCase();

const ref = (owner: string, table: string, col: string) => `${owner}.${table}.${col}`;

/** Bucket grosseiro de tipo, para checar compatibilidade coluna ↔ PK alvo. */
function bucket(dataType: string): string {
  const u = dataType.toUpperCase();
  if (/(NUMBER|INT|DEC|NUMERIC|FLOAT|DOUBLE|SMALLINT|REAL)/.test(u)) return "num";
  if (/(CHAR|CLOB|TEXT|STRING)/.test(u)) return "str";
  if (/(DATE|TIME)/.test(u)) return "date";
  return u;
}

/** Deriva o nome-base da tabela a partir do nome da coluna: CLIENTE_ID → CLIENTE. */
function baseName(col: string): string {
  return col
    .toUpperCase()
    .replace(/^ID[_]/, "")
    .replace(/[_](ID|CODIGO|COD|FK|KEY|SK)$/, "");
}

/** Casa o nome-base contra tabelas com PK de coluna única (singular/plural simples). */
function matchTable(base: string, byTable: Map<string, SchemaKeyColumn>): SchemaKeyColumn | undefined {
  for (const cand of [base, base.replace(/S$/, ""), `${base}S`]) {
    const hit = byTable.get(cand);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Infere FKs implícitas de um inventário de schema.
 * `high`: nome da tabela alvo casa por convenção E tipos compatíveis.
 * `medium`: só o nome da coluna casa com a PK de outra tabela, ou os tipos divergem.
 */
export function inferImplicitFks(inv: SchemaInventory): ImpliedRelationship[] {
  // PKs de coluna única: contamos colunas por PK e descartamos compostas.
  const pkCols = new Map<string, number>();
  for (const p of inv.primaryKeys) pkCols.set(norm(p.owner, p.table), (pkCols.get(norm(p.owner, p.table)) ?? 0) + 1);

  const singlePkByTable = new Map<string, SchemaKeyColumn>();
  const singlePkByColName = new Map<string, SchemaKeyColumn[]>();
  for (const p of inv.primaryKeys) {
    if (pkCols.get(norm(p.owner, p.table)) !== 1) continue;
    singlePkByTable.set(p.table.toUpperCase(), p);
    const arr = singlePkByColName.get(p.column.toUpperCase()) ?? [];
    arr.push(p);
    singlePkByColName.set(p.column.toUpperCase(), arr);
  }

  const declared = new Set(inv.declaredFkColumns.map((f) => norm(f.owner, f.table, f.column)));
  const isPk = new Set(inv.primaryKeys.map((p) => norm(p.owner, p.table, p.column)));
  const typeByCol = new Map(inv.columns.map((c) => [norm(c.owner, c.table, c.column), c.dataType]));

  const out: ImpliedRelationship[] = [];
  for (const c of inv.columns) {
    const self = norm(c.owner, c.table, c.column);
    if (declared.has(self) || isPk.has(self)) continue;

    const base = baseName(c.column);
    const target = base.length >= 2 ? matchTable(base, singlePkByTable) : undefined;
    if (target) {
      const compatible = bucket(c.dataType) === bucket(typeByCol.get(norm(target.owner, target.table, target.column)) ?? "");
      out.push({
        from: ref(c.owner, c.table, c.column),
        to: ref(target.owner, target.table, target.column),
        confidence: compatible ? "high" : "medium",
        evidence: `nome '${c.column}' → tabela ${target.table} (PK ${target.column})${compatible ? "" : "; tipos divergem"}`,
      });
      continue;
    }

    // Fallback: a coluna tem o mesmo nome que a PK de exatamente uma outra tabela.
    const byName = (singlePkByColName.get(c.column.toUpperCase()) ?? []).filter(
      (p) => norm(p.owner, p.table) !== norm(c.owner, c.table),
    );
    if (byName.length === 1) {
      const t = byName[0];
      out.push({
        from: ref(c.owner, c.table, c.column),
        to: ref(t.owner, t.table, t.column),
        confidence: "medium",
        evidence: `coluna '${c.column}' casa com a PK de ${t.table}`,
      });
    }
  }
  return out;
}
