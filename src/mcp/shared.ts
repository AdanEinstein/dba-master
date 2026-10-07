import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Config } from "../config.js";

// Utilidades compartilhadas pelas tools: envelope de resposta e args comuns.

/** Envelope padrão: toda tool devolve JSON em text para consumo por outro agente. */
export function jsonResult(data: unknown) {
  // ponytail: JSON compacto (sem pretty-print) — corta ~30% de tokens em toda resposta.
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

/**
 * Guarda de escrita por conexão: só o booleano literal `readOnly: false` libera.
 * Ausente (default true), true ou qualquer outro valor (ex. "false" string) bloqueia.
 */
export function assertWritable(cfg: Config, name: string, what: string): void {
  if (cfg.connections[name]?.readOnly !== false) {
    throw new Error(
      `Conexão "${name}" é read-only: ${what} bloqueado. Para liberar só esta conexão, ` +
        `defina "readOnly": false nela (connections.json ou "npx dba-master configure" → editar).`,
    );
  }
}

export function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true };
}

/**
 * Linhas em formato colunar: os nomes das colunas aparecem uma vez, não por linha.
 * Corta ~50% dos tokens de uma listagem grande. Aplica teto e sinaliza o corte.
 * ponytail: sem cursor — refine schema/pattern ou suba limit.
 */
export function tabular(rows: readonly object[], limit = 200) {
  const shown = rows.slice(0, limit) as Record<string, unknown>[];
  // União das chaves: providers podem omitir campos opcionais em algumas linhas.
  const cols = [...new Set(shown.flatMap((r) => Object.keys(r)))];
  return {
    cols,
    rows: shown.map((r) => cols.map((c) => r[c] ?? null)),
    count: shown.length,
    ...(rows.length > limit ? { total: rows.length, truncated: true } : {}),
  };
}

// Args compartilhados: o texto de cada um é serializado em TODA tool que o usa
// (20x para connectionArg), então cada palavra aqui custa 20 vezes no tools/list.
export const limitArg = z.number().int().positive().optional().describe("Máx. linhas (default 200).");

export const schemaArg = z.string().optional().describe("Schema/owner. Omitir = todos.");

export const patternArg = z.string().optional().describe("Substring do nome (case-insensitive).");

export const connectionArg = z.string().optional().describe("Conexão alvo (se houver várias).");

/**
 * Lê arquivo de fonte no encoding certo: `encoding` explícito > BOM > UTF-8 estrito > Windows-1252.
 * Fonte grande (centenas de KB) não cabe num argumento de tool — o servidor lê do disco.
 * ponytail: heurística BOM→UTF-8→1252 (1252 nunca falha). Outro encoding sem BOM → passe `encoding`.
 */
export async function readSourceFile(path: string, encoding?: string): Promise<{ text: string; encoding: string; bytes: number }> {
  const buf = await readFile(path);
  const enc =
    encoding ??
    (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? "utf-8"
      : buf[0] === 0xff && buf[1] === 0xfe ? "utf-16le"
      : buf[0] === 0xfe && buf[1] === 0xff ? "utf-16be"
      : isUtf8(buf) ? "utf-8"
      : "windows-1252");
  return { text: new TextDecoder(enc).decode(buf), encoding: enc, bytes: buf.length };
}

function isUtf8(buf: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}
