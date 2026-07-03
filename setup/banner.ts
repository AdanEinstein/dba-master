import cfonts from "cfonts";

// Banner do DBA-Master com animação de entrada, compartilhado pelos 3 fluxos
// da TUI (install/uninstall/configure). Sem dependência nova: usa cfonts.render
// (linhas já coloridas) + ANSI truecolor + timers da stdlib.
//
// Sequência da entrada: revela o logo linha a linha → varre uma régua com
// gradiente da esquerda p/ direita → digita a tagline (typewriter, dim).

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ESC = "\x1b[";
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const RESET_FG = `${ESC}39m`;
const dim = (s: string) => `${ESC}2m${s}${ESC}22m`;

const REVEAL_DELAY_MS = 40; // por linha do logo
const RULE_DELAY_MS = 6; // por caractere da régua
const TYPE_DELAY_MS = 14; // por caractere da tagline

const TAGLINE = "Introspecção de banco para agentes de IA · Oracle · PostgreSQL · MySQL";

export interface BannerStyle {
  colors: [string, string];
  gradient: [string, string];
}

/** "#f80"/"#ff8800" → [r, g, b]. */
function toRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

/** Régua "───" com gradiente interpolado entre duas cores, como array de células. */
function gradientRuleCells(width: number, c0: string, c1: string): string[] {
  const [r0, g0, b0] = toRgb(c0);
  const [r1, g1, b1] = toRgb(c1);
  const cells: string[] = [];
  for (let i = 0; i < width; i++) {
    const t = width <= 1 ? 0 : i / (width - 1);
    const r = Math.round(r0 + (r1 - r0) * t);
    const g = Math.round(g0 + (g1 - g0) * t);
    const b = Math.round(b0 + (b1 - b0) * t);
    cells.push(`${ESC}38;2;${r};${g};${b}m─`);
  }
  return cells;
}

/** Renderiza "DBA-MASTER" + régua + tagline. Com TTY, anima; sem TTY, sai de uma vez. */
export async function showBanner(style: BannerStyle): Promise<void> {
  const { array } = cfonts.render("DBA-MASTER", {
    font: "block",
    align: "left",
    colors: style.colors,
    background: "transparent",
    letterSpacing: 1,
    lineHeight: 1,
    space: true,
    maxLength: "0",
    gradient: style.gradient,
    independentGradient: false,
    transitionGradient: true,
    env: "node",
  }) as unknown as { array: string[] };

  const width = Math.max(1, ...array.map((l) => strip(l).length));
  const rule = gradientRuleCells(width, style.colors[0], style.colors[1]);
  const pad = " ".repeat(Math.max(0, Math.floor((width - TAGLINE.length) / 2)));

  const out = (s: string) => process.stdout.write(s);

  // Sem terminal interativo (CI, pipe, redirect): tudo de uma vez, sem delays.
  if (!process.stdout.isTTY) {
    out(array.join("\n") + "\n");
    out(rule.join("") + RESET_FG + "\n");
    out(dim(pad + TAGLINE) + "\n");
    return;
  }

  out(HIDE_CURSOR);
  try {
    for (const line of array) {
      out(line + "\n");
      await sleep(REVEAL_DELAY_MS);
    }
    for (const cell of rule) {
      out(cell);
      await sleep(RULE_DELAY_MS);
    }
    out(RESET_FG + "\n");
    for (const ch of pad + TAGLINE) {
      out(dim(ch));
      await sleep(TYPE_DELAY_MS);
    }
    out("\n");
  } finally {
    out(SHOW_CURSOR); // restaura o cursor mesmo se interrompido
  }
}
