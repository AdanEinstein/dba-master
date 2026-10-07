// Lógica pura de fonte PL/SQL para compile_object: quebra o script em unidades,
// extrai tipo/owner/nome do cabeçalho CREATE e monta o ALTER ... COMPILE.

export interface PlsqlUnit {
  sql: string;
  type: string;
  owner?: string;
  name: string;
}

const IDENT = String.raw`("[^"]+"|[A-Za-z][\w$#]*)`;
const HEADER = new RegExp(
  String.raw`^CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:NON)?EDITIONABLE\s+)?(?:NO\s+)?(?:FORCE\s+)?` +
    String.raw`(PACKAGE\s+BODY|PACKAGE|PROCEDURE|FUNCTION|TRIGGER|TYPE\s+BODY|TYPE|VIEW)\s+` +
    String.raw`(?:${IDENT}\s*\.\s*)?${IDENT}`,
  "i",
);
const LEADING_COMMENTS = /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/;

/** Identificador Oracle: quoted mantém o case, sem aspas vira MAIÚSCULO. */
const normIdent = (s: string) => (s.startsWith('"') ? s.slice(1, -1) : s.toUpperCase());

/**
 * Quebra um script estilo SQL*Plus (unidades separadas por linha com só `/`) e
 * identifica cada unidade pelo cabeçalho CREATE.
 * ponytail: `/` sozinho na linha dentro de comentário/string quebra o split — teto aceito.
 */
export function parsePlsqlSource(source: string): PlsqlUnit[] {
  const units = source.split(/^\s*\/\s*$/m).map((s) => s.trim()).filter(Boolean);
  if (units.length === 0) throw new Error("source vazio.");
  return units.map((raw) => {
    const sql = raw.replace(LEADING_COMMENTS, "");
    const m = HEADER.exec(sql);
    if (!m) throw new Error(`Unidade sem cabeçalho CREATE reconhecido: ${sql.slice(0, 80)}`);
    const type = m[1].toUpperCase().replace(/\s+/g, " ");
    return {
      // VIEW é SQL puro: `;` final quebra o execute. PL/SQL precisa do `END;`.
      sql: type === "VIEW" ? sql.replace(/;\s*$/, "") : sql,
      type,
      owner: m[2] ? normIdent(m[2]) : undefined,
      name: normIdent(m[3]),
    };
  });
}

const ALTER_BASE: Record<string, string> = {
  PACKAGE: "PACKAGE",
  "PACKAGE BODY": "PACKAGE",
  PROCEDURE: "PROCEDURE",
  FUNCTION: "FUNCTION",
  TRIGGER: "TRIGGER",
  VIEW: "VIEW",
  TYPE: "TYPE",
  "TYPE BODY": "TYPE",
  "MATERIALIZED VIEW": "MATERIALIZED VIEW",
};

/** `ALTER <tipo> "OWNER"."NOME" COMPILE [BODY]`. DDL não aceita bind: aspas + recusa de `"` impedem injeção. */
export function alterCompileSql(type: string, owner: string, name: string): string {
  const t = type.toUpperCase().replace(/\s+/g, " ");
  const base = ALTER_BASE[t];
  if (!base) throw new Error(`objectType '${type}' não é compilável. Use: ${Object.keys(ALTER_BASE).join(", ")}.`);
  for (const id of [owner, name]) {
    if (!id || id.includes('"') || id.includes("\0")) throw new Error(`Identificador inválido: ${id}`);
  }
  return `ALTER ${base} "${owner}"."${name}" COMPILE${t.endsWith(" BODY") ? " BODY" : ""}`;
}
