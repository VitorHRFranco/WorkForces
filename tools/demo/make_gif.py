#!/usr/bin/env python3
"""Monta o GIF do README a partir dos quadros gravados por `pnpm demo` (packages/e2e/demo/readme.capture.ts).

Uso: python tools/demo/make_gif.py packages/e2e/demo-frames docs/media/demo.gif
"""
import argparse
import json
import os

from PIL import Image

# Paleta única para todos os quadros: sem ela, cada quadro escolhe cores diferentes e a imagem pisca.
PALETTE_SAMPLES = 12
COLORS = 255


def build_palette(frames):
    """Paleta tirada de quadros espalhados pela gravação inteira."""
    step = max(1, len(frames) // PALETTE_SAMPLES)
    samples = frames[::step]
    width, height = samples[0].size
    sheet = Image.new("RGB", (width, height * len(samples)))
    for i, frame in enumerate(samples):
        sheet.paste(frame, (0, i * height))
    return sheet.quantize(colors=COLORS, method=Image.Quantize.MEDIANCUT)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("frames", help="pasta com os PNG e o timing.json")
    parser.add_argument("output", help="GIF de saída")
    parser.add_argument("--scale", type=float, default=1.0, help="escala dos quadros (1 = tamanho da janela gravada)")
    args = parser.parse_args()

    with open(os.path.join(args.frames, "timing.json"), encoding="utf-8") as file:
        timing = json.load(file)
    frames = []
    for entry in timing:
        frame = Image.open(os.path.join(args.frames, entry["file"])).convert("RGB")
        if args.scale != 1.0:
            frame = frame.resize((round(frame.width * args.scale), round(frame.height * args.scale)), Image.Resampling.NEAREST)
        frames.append(frame)
    palette = build_palette(frames)
    indexed = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
    # O GIF guarda a duração em centésimos de segundo.
    durations = [max(20, round(entry["ms"] / 10) * 10) for entry in timing]
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    indexed[0].save(args.output, save_all=True, append_images=indexed[1:], duration=durations, loop=0, optimize=True, disposal=1)
    print(f"{args.output}: {len(indexed)} quadros, {os.path.getsize(args.output) // 1024} KB")


if __name__ == "__main__":
    main()
