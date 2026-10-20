import Phaser from "phaser";
import { useEffect, useRef } from "preact/hooks";
import { OfficeScene, type OfficeSceneDeps } from "./office-scene";

/** Monta o jogo uma vez (as dependências são estáveis durante a vida da página). */
export function GameView({ deps, keyboardEnabled, panelOpen }: { deps: OfficeSceneDeps; keyboardEnabled: boolean; panelOpen: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<OfficeScene | null>(null);

  useEffect(() => {
    const element = host.current!;
    const officeScene = new OfficeScene(deps);
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: element,
      pixelArt: true,
      backgroundColor: deps.map.backgroundColor ?? "#000000",
      scale: { mode: Phaser.Scale.RESIZE, width: element.clientWidth, height: element.clientHeight },
      physics: { default: "arcade", arcade: { gravity: { x: 0, y: 0 } } },
      scene: [officeScene],
    });
    scene.current = officeScene;
    // Clicar no mapa devolve o teclado ao jogo (o Phaser faz preventDefault no mousedown do canvas).
    const releaseFocus = () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) active.blur();
    };
    element.addEventListener("pointerdown", releaseFocus);
    return () => {
      element.removeEventListener("pointerdown", releaseFocus);
      scene.current = null;
      game.destroy(true);
    };
  }, []);

  useEffect(() => scene.current?.setKeyboardEnabled(keyboardEnabled), [keyboardEnabled]);
  useEffect(() => scene.current?.setPanelOpen(panelOpen), [panelOpen]);

  return <div class="game" ref={host} />;
}
