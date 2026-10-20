/** Medidas do .desk-panel em styles.css: `right: 12px` e `width: min(760px, calc(100% - 24px))`. */
const PANEL_MAX_WIDTH = 760;
const PANEL_MARGIN = 12;
/** Com menos mapa que isso à vista, não vale a pena desviar a câmera. */
const MIN_VISIBLE = 240;

/** Quantos px de tela, a partir da direita do canvas, o painel do terminal cobre (0 se fechado ou se a janela for estreita demais). */
export function panelInset(canvasWidth: number, open: boolean): number {
  if (!open) return 0;
  const inset = Math.min(PANEL_MAX_WIDTH, canvasWidth - 2 * PANEL_MARGIN) + PANEL_MARGIN;
  return canvasWidth - inset >= MIN_VISIBLE ? inset : 0;
}

/**
 * Enquadramento com o painel aberto: o avatar fica no meio da parte visível do mapa (deslocamento negativo
 * no `followOffset` do Phaser) e o limite da câmera cresce à direita, para isso valer também perto da borda.
 */
export function cameraFrame(mapWidthPx: number, insetPx: number, zoom: number): { boundsWidth: number; offsetX: number } {
  return { boundsWidth: mapWidthPx + insetPx / zoom, offsetX: insetPx === 0 ? 0 : -insetPx / (2 * zoom) };
}
