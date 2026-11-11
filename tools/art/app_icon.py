#!/usr/bin/env python3
"""Gera o ícone do instalador (packages/app/release/icon.png) a partir do robô do jogo.

Uso, na raiz do repositório (precisa de Python 3.10+ e Pillow):
    python tools/art/app_icon.py

Recorta o primeiro quadro do robô (o mesmo que a bandeja usa), amplia sem suavizar e centraliza num PNG 256×256
transparente, o tamanho que o electron-builder pede para o ícone do Windows.
"""
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SOURCE = os.path.join(ROOT, "packages", "client", "public", "sprites", "robot.png")
TARGET = os.path.join(ROOT, "packages", "app", "release", "icon.png")
FRAME = (0, 0, 24, 28)  # o recorte da bandeja (packages/app/src/main.ts)
SCALE = 9
SIZE = 256


def main():
    robot = Image.open(SOURCE).convert("RGBA").crop(FRAME)
    big = robot.resize((robot.width * SCALE, robot.height * SCALE), Image.Resampling.NEAREST)
    icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    icon.paste(big, ((SIZE - big.width) // 2, (SIZE - big.height) // 2))
    icon.save(TARGET, optimize=True)
    print(f"ícone gravado em {os.path.relpath(TARGET, ROOT)} ({SIZE}×{SIZE})")


if __name__ == "__main__":
    main()
