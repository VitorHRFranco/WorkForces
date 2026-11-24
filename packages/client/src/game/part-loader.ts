import type { Rgba } from "./compose";

/** As peças do personagem lidas fora do Phaser (a prévia do "Personalizar"): cada arquivo uma vez. */
export class PartLoader {
  private readonly loading = new Map<string, Promise<Rgba>>();

  constructor(private readonly decode: (url: string) => Promise<Rgba>) {}

  load(file: string): Promise<Rgba> {
    let pending = this.loading.get(file);
    if (!pending) {
      pending = this.decode(`/sprites/parts/${file}`);
      this.loading.set(file, pending);
      // Uma leitura que falhou não fica guardada: a próxima tenta de novo.
      pending.catch(() => {
        if (this.loading.get(file) === pending) this.loading.delete(file);
      });
    }
    return pending;
  }
}

/** Lê uma imagem da página como RGBA (desenhando-a num canvas). */
export function decodeImage(url: string): Promise<Rgba> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      context.drawImage(img, 0, 0);
      const { width, height, data } = context.getImageData(0, 0, img.width, img.height);
      resolve({ width, height, data });
    };
    img.onerror = () => reject(new Error(`não consegui ler ${url}`));
    img.src = url;
  });
}
