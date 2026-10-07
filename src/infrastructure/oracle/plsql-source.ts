// Lógica pura de fonte para compile_object: quebra um script estilo SQL*Plus em unidades
// (PL/SQL, SQL solto, comando SQL*Plus) e monta o ALTER ... COMPILE.

export interface PlsqlUnit {
  /** plsql: CREATE de objeto compilável (tem status). sql: executa e pronto. skipped: comando SQL*Plus. */
  kind: "plsql" | "sql" | "skipped";
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
/** Bloco anônimo: como PL/SQL, só termina na linha `/` (tem `;` internos). */
const ANON_BLOCK = /^(?:BEGIN|DECLARE)\b/i;
const SLASH = /^\s*\/\s*$/;
/** Comandos do cliente SQL*Plus/SQLcl: não são SQL, o banco rejeitaria. */
const SQLPLUS =
  /^\s*(?:@@?|!|(?:SET(?!\s+(?:TRANSACTION|ROLE|CONSTRAINTS?)\b)|PRO(?:MPT)?|SPO(?:OL)?|WHENEVER|SHO(?:W)?|EXIT|QUIT|REM(?:ARK)?|DEF(?:INE)?|UNDEF(?:INE)?|COL(?:UMN)?|CONN(?:ECT)?|DISC(?:ONNECT)?|ACC(?:EPT)?|VAR(?:IABLE)?|PRINT|PAUSE|HOST|STA(?:RT)?|CL(?:EAR)?|BRE(?:AK)?|TTI(?:TLE)?|BTI(?:TLE)?|TIMI(?:NG)?)(?:\s|;|$))/i;
const EXEC = /^\s*EXEC(?:UTE)?\s+([\s\S]*?);?\s*$/i;

/** Identificador Oracle: quoted mantém o case, sem aspas vira MAIÚSCULO. */
const normIdent = (s: string) => (s.startsWith('"') ? s.slice(1, -1) : s.toUpperCase());

const label = (sql: string) => sql.split("\n")[0].trim().slice(0, 60);

/**
 * Quebra um script SQL*Plus em unidades. Nunca lança: o que não é PL/SQL vira SQL
 * solto (termina em `;` no fim da linha) ou comando SQL*Plus pulado.
 * PL/SQL e bloco anônimo terminam na linha com só `/`.
 * ponytail: `;`/`/` em fim de linha dentro de comentário/string literal quebram o split — teto aceito.
 */
export function parsePlsqlSource(source: string): PlsqlUnit[] {
  const out: PlsqlUnit[] = [];
  let buf: string[] = [];
  let block = false; // dentro de PL/SQL / bloco anônimo: só `/` encerra

  const flush = () => {
    const sql = buf.join("\n").replace(LEADING_COMMENTS, "").trim();
    buf = [];
    block = false;
    if (!sql) return;
    const m = HEADER.exec(sql);
    if (m) {
      const type = m[1].toUpperCase().replace(/\s+/g, " ");
      // VIEW é SQL puro: `;` final quebra o execute. PL/SQL precisa do `END;`.
      out.push({
        kind: "plsql",
        sql: type === "VIEW" ? sql.replace(/;\s*$/, "") : sql,
        type,
        owner: m[2] ? normIdent(m[2]) : undefined,
        name: normIdent(m[3]),
      });
    } else {
      out.push({ kind: "sql", sql: ANON_BLOCK.test(sql) ? sql : sql.replace(/;\s*$/, ""), type: "SQL", name: label(sql) });
    }
  };

  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    if (SLASH.test(line)) {
      flush();
      continue;
    }
    if (block) {
      buf.push(line);
      continue;
    }
    // Fora de bloco o buffer é um statement curto: re-juntar a cada linha é barato.
    const pending = buf.join("\n").replace(LEADING_COMMENTS, "");
    if (!pending) {
      const exec = EXEC.exec(line);
      if (exec) {
        out.push({ kind: "sql", sql: `BEGIN ${exec[1].trim()}; END;`, type: "SQL", name: label(line) });
        continue;
      }
      if (SQLPLUS.test(line)) {
        out.push({ kind: "skipped", sql: line.trim(), type: "SQLPLUS", name: label(line) });
        continue;
      }
    }
    buf.push(line);
    const head = (pending ? pending + "\n" : "") + line.replace(LEADING_COMMENTS, "");
    // VIEW termina em `;` como SQL comum; demais CREATE PL/SQL só no `/`.
    const m = HEADER.exec(head);
    block = (!!m && !/^VIEW$/i.test(m[1])) || ANON_BLOCK.test(head);
    if (!block && /;\s*(?:--.*)?$/.test(line)) flush();
  }
  flush();
  return out;
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
