import { appearanceKey, type Appearance } from "@workforces/protocol";
import { useEffect, useRef } from "preact/hooks";
import { composeSheet, layersOf, type Rgba } from "../game/compose";
import { PartLoader, decodeImage } from "../game/part-loader";
import { PERSON_FRAME } from "../game/people";

const loader = new PartLoader(decodeImage);
const SCALE = 2;
const DIRECTIONS = 4;
const WALK_FRAMES = 8;
const FPS = 12;

/** Monta a folha da aparência, lendo antes as peças que ela usa. */
async function sheetOf(appearance: Appearance): Promise<HTMLCanvasElement> {
  const files = [...new Set(layersOf(appearance).map((layer) => layer.file))];
  const images = new Map<string, Rgba>();
  await Promise.all(files.map(async (file) => images.set(file, await loader.load(file))));
  const sheet = composeSheet(appearance, (file) => images.get(file)!);
  const canvas = document.createElement("canvas");
  canvas.width = sheet.width;
  canvas.height = sheet.height;
  const context = canvas.getContext("2d")!;
  const data = context.createImageData(sheet.width, sheet.height);
  data.data.set(sheet.data);
  context.putImageData(data, 0, 0);
  return canvas;
}

/** O personagem andando nas 4 direções (cima, esquerda, baixo, direita), lado a lado. */
export function CharacterPreview({ appearance }: { appearance: Appearance }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sheetRef = useRef<HTMLCanvasElement | null>(null);
  const key = appearanceKey(appearance);

  // Remonta só quando a aparência muda; enquanto monta, a imagem anterior continua.
  useEffect(() => {
    let alive = true;
    sheetOf(appearance).then(
      (sheet) => {
        if (alive) sheetRef.current = sheet;
      },
      (error: unknown) => console.warn("não consegui montar a prévia do personagem", error),
    );
    return () => {
      alive = false;
    };
  }, [key]);

  useEffect(() => {
    let frame = 0;
    const timer = window.setInterval(() => {
      const canvas = canvasRef.current;
      const sheet = sheetRef.current;
      if (!canvas || !sheet) return;
      const context = canvas.getContext("2d")!;
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, canvas.width, canvas.height);
      for (let row = 0; row < DIRECTIONS; row++) {
        const size = PERSON_FRAME * SCALE;
        context.drawImage(sheet, frame * PERSON_FRAME, row * PERSON_FRAME, PERSON_FRAME, PERSON_FRAME, row * size, 0, size, size);
      }
      frame = (frame + 1) % WALK_FRAMES;
    }, 1000 / FPS);
    return () => window.clearInterval(timer);
  }, []);

  return <canvas ref={canvasRef} class="character-preview" width={PERSON_FRAME * SCALE * DIRECTIONS} height={PERSON_FRAME * SCALE} aria-label="Prévia do personagem" />;
}
