import { z } from "zod";

// Utilidades compartilhadas pelas tools: envelope de resposta e args comuns.

/** Envelope padrão: toda tool devolve JSON em text para consumo por outro agente. */
export function jsonResult(data: unknown) {
  // ponytail: JSON compacto (sem pretty-print) — corta ~30% de tokens em toda resposta.
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

export function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true };
}

export const schemaArg = z
  .string()
  .optional()
  .describe("Schema (owner) alvo. Se omitido, busca em todos os schemas acessíveis.");

export const patternArg = z
  .string()
  .optional()
  .describe("Substring do nome a filtrar (case-insensitive). Omitir = todos.");

export const connectionArg = z
  .string()
  .optional()
  .describe("Nome da conexão alvo. Necessário se houver múltiplas conexões configuradas.");
