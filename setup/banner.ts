import cfonts from "cfonts";

// Banner do DBA-Master com animação de entrada, compartilhado pelos 3 fluxos
// da TUI (install/uninstall/configure). Sem dependência nova: usa cfonts.render
// (devolve as linhas já coloridas) + timers da stdlib para revelar de cima p/ baixo.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface BannerStyle {
  colors: [string, string];
  gradient: [string, string];
}

const REVEAL_DELAY_MS = 45;

/** Renderiza "DBA-MASTER" revelando linha a linha. Sem TTY, imprime de uma vez. */
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

  // Sem terminal interativo (CI, pipe, redirecionamento): nada de animação.
  if (!process.stdout.isTTY) {
    process.stdout.write(array.join("\n") + "\n");
    return;
  }

  process.stdout.write("\x1b[?25l"); // esconde o cursor durante a revelação
  try {
    for (const line of array) {
      process.stdout.write(line + "\n");
      await sleep(REVEAL_DELAY_MS);
    }
  } finally {
    process.stdout.write("\x1b[?25h"); // restaura o cursor mesmo se interrompido
  }
}
