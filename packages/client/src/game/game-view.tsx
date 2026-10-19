import Phaser from "phaser";
import { useEffect, useRef } from "preact/hooks";
import { OfficeScene, type OfficeSceneDeps } from "./office-scene";

/** Monta o jogo uma vez (as dependências são estáveis durante a vida da página). */
export function GameView({ deps, keyboardEnabled }: { deps: OfficeSceneDeps; keyboardEnabled: boolean }) {
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
    return () => {
      scene.current = null;
      game.destroy(true);
    };
  }, []);

  useEffect(() => scene.current?.setKeyboardEnabled(keyboardEnabled), [keyboardEnabled]);

  return <div class="game" ref={host} />;
}
