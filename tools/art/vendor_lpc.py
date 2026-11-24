#!/usr/bin/env python3
"""Copia do LPC Revised, no commit fixado, os arquivos que o projeto usa para assets/lpc/ e deriva as rampas de cor.

Uso, na raiz do repositório (precisa de rede, Python 3.10+ e Pillow):
    python tools/art/vendor_lpc.py

O que grava em assets/lpc/ (a pasta é refeita do zero):
- as peças do personagem (tools/art/catalog.py), cada uma só na cor de referência da família, nas poses usadas;
- os móveis e tiles que o gerador usa (catalog.STATIC_FILES) e a paleta (_ Palette/palette.json);
- os Credits.txt de cada pasta no caminho de cada arquivo copiado;
- ramps.json: a rampa de cada cor com nome, derivada das peças de amostra;
- ORIGEM.md.

Os arquivos do LPC são copiados sem modificação. O script confere que cada cor com nome é uma troca exata de tons da cor
de referência e que cada peça do catálogo segue as rampas, e falha com uma mensagem clara se não for assim.
"""
import concurrent.futures
import datetime
import io
import json
import os
import shutil
import sys
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catalog  # noqa: E402

RAW = f"https://raw.githubusercontent.com/ElizaWy/LPC/{catalog.LPC_COMMIT}/"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "assets", "lpc")
# A amostra de cada cor e a conferência das peças usam todas as poses: um tom pode aparecer numa pose só (o branco do
# olho da cabeça só aparece nos quadros de andar).
SAMPLES = [f"{anim}.png" for anim in catalog.ANIMS]


class VendorError(Exception):
    pass


def fetch(path, missing_ok=False):
    """Baixa um arquivo do LPC; None se não existir e missing_ok."""
    for attempt in range(4):
        try:
            with urllib.request.urlopen(RAW + urllib.parse.quote(path), timeout=60) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code == 404:
                if missing_ok:
                    return None
                raise VendorError(f"o LPC não tem {path}") from error
            if attempt == 3:
                raise
        except urllib.error.URLError:
            if attempt == 3:
                raise


def fetch_all(paths, missing_ok=False):
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        return dict(zip(paths, pool.map(lambda p: fetch(p, missing_ok), paths)))


def image(data):
    return Image.open(io.BytesIO(data)).convert("RGBA")


def hexcolor(rgb):
    return "#%02x%02x%02x" % rgb[:3]


def luminance(hex_color):
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def mapping(ref, other, where):
    """A troca de tons de `ref` para `other` (mesma imagem em outra cor): {tom: tom}. Falha se não for uma troca exata."""
    if ref.size != other.size:
        raise VendorError(f"{where}: tamanhos diferentes ({ref.size} e {other.size})")
    result = {}
    for a, b in zip(ref.getdata(), other.getdata()):
        if a[3] != b[3]:
            raise VendorError(f"{where}: a transparência muda entre as cores")
        if a[3] == 0:
            continue
        ta, tb = hexcolor(a), hexcolor(b)
        if result.setdefault(ta, tb) != tb:
            raise VendorError(f"{where}: o tom {ta} vai para dois tons diferentes ({result[ta]} e {tb})")
    return result


def derive_ramps(name, family):
    """A rampa de referência e a de cada cor com nome, a partir das amostras em todas as cores."""
    reference = family["reference"]
    paths = [f"{probe}/{color}/{sample}" for probe in family["probes"] for color in family["colors"] for sample in SAMPLES]
    data = fetch_all(paths)
    maps = {color: {} for color in family["colors"]}
    for probe in family["probes"]:
        for sample in SAMPLES:
            ref = image(data[f"{probe}/{reference}/{sample}"])
            for color in family["colors"]:
                found = mapping(ref, image(data[f"{probe}/{color}/{sample}"]), f"{probe}/{sample} ({reference} → {color})")
                for tone, target in found.items():
                    if maps[color].setdefault(tone, target) != target:
                        raise VendorError(f"{name}: o tom {tone} vai para tons diferentes em {color} nas amostras")
    changing = {tone for found in maps.values() for tone, target in found.items() if target != tone}
    ramp = sorted(changing, key=luminance)
    named = {color: [maps[color][tone] for tone in ramp] for color in family["colors"]}
    # A paleta do LPC é pequena: cores diferentes dividem tons (nenhuma posição da rampa separa todas as cores de roupa),
    # então uma aparência guarda a cor com nome pelo nome. A rampa inteira, essa, tem que ser única.
    seen = {}
    for color, tones in named.items():
        if tuple(tones) in seen:
            raise VendorError(f"{name}: {color} e {seen[tuple(tones)]} têm a mesma rampa")
        seen[tuple(tones)] = color
    return {"reference": ramp, "named": named}


def witness_color(family):
    return next(color for color in sorted(family["colors"]) if color != family["reference"])


def check_piece(path_ref, path_witness, ramps, family_name, family, data):
    """A peça na cor de referência e numa segunda cor seguem as rampas: tom da rampa troca como manda a rampa, o resto fica."""
    ramp = ramps[family_name]
    target = dict(zip(ramp["reference"], ramp["named"][witness_color(family)]))
    found = mapping(image(data[path_ref]), image(data[path_witness]), path_ref)
    for tone, goes in found.items():
        expected = target.get(tone, tone)
        if goes != expected:
            kind = "um tom fixo da peça está na rampa de referência" if tone in target else "um tom fora da rampa muda de cor"
            raise VendorError(f"{path_ref}: {kind} ({tone} vai para {goes}, a rampa manda {expected})")


def credit_candidates(paths):
    """Os Credits.txt possíveis: um em cada pasta do caminho de cada arquivo, até a raiz."""
    folders = set()
    for path in paths:
        parts = path.split("/")[:-1]
        for depth in range(len(parts), -1, -1):
            folders.add("/".join(parts[:depth]))
    return sorted(f"{folder}/Credits.txt" if folder else "Credits.txt" for folder in folders)


def write_ramps(ramps):
    lines = ["{"]
    for i, (name, ramp) in enumerate(ramps.items()):
        lines.append(f'  "{name}": {{')
        lines.append(f'    "reference": {json.dumps(ramp["reference"])},')
        lines.append('    "named": {')
        entries = [f'      {json.dumps(color)}: {json.dumps(tones)}' for color, tones in ramp["named"].items()]
        lines.append(",\n".join(entries))
        lines.append("    }")
        lines.append("  }" + ("," if i < len(ramps) - 1 else ""))
    lines.append("}")
    with open(os.path.join(OUT, "ramps.json"), "w", encoding="utf-8", newline="\n") as out:
        out.write("\n".join(lines) + "\n")


def write_origin():
    today = datetime.date.today().strftime("%d/%m/%Y")
    text = f"""# Origem dos arquivos do LPC

- Repositório: https://github.com/ElizaWy/LPC (LPC Revised)
- Commit: `{catalog.LPC_COMMIT}`
- Copiados em {today} por `tools/art/vendor_lpc.py`.

Os arquivos copiados sem modificação, no mesmo caminho do repositório de origem, sob a licença OGA-BY 3.0
(https://static.opengameart.org/OGA-BY-3.0.txt). Os `Credits.txt` de cada pasta vêm junto, como estão na origem; o
resumo dos créditos está em `assets/CREDITS.md`.

`ramps.json` é derivado deles por `tools/art/vendor_lpc.py`: para cada família de cor (pele, cabelo, roupa, metal), os
tons da cor de referência e, na mesma ordem, os tons de cada cor com nome.
"""
    with open(os.path.join(OUT, "ORIGEM.md"), "w", encoding="utf-8", newline="\n") as out:
        out.write(text)


def main():
    ramps = {name: derive_ramps(name, family) for name, family in catalog.FAMILIES.items()}

    piece_paths = []
    checks = []
    for piece in catalog.PIECES:
        family = catalog.FAMILIES[piece["family"]]
        for files in catalog.piece_files(piece).values():
            piece_paths += files
            for sample in files:
                witness = sample.replace(f"/{family['reference']}/", f"/{witness_color(family)}/")
                checks.append((sample, witness, piece["family"], family))
    copied_paths = piece_paths + catalog.STATIC_FILES + [catalog.PALETTE_FILE]

    data = fetch_all(copied_paths)
    data.update(fetch_all([witness for _, witness, _, _ in checks]))
    for sample, witness, family_name, family in checks:
        check_piece(sample, witness, ramps, family_name, family, data)

    credits = {path: body for path, body in fetch_all(credit_candidates(copied_paths), missing_ok=True).items() if body is not None}

    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    total = 0
    for path, body in [(path, data[path]) for path in copied_paths] + list(credits.items()):
        target = os.path.join(OUT, *path.split("/"))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as out:
            out.write(body)
        total += len(body)
    write_ramps(ramps)
    write_origin()
    print(f"{len(copied_paths)} arquivos e {len(credits)} Credits.txt copiados para assets/lpc ({total / 1_000_000:.1f} MB)")
    for name, ramp in ramps.items():
        print(f"  {name}: rampa de {len(ramp['reference'])} tons, {len(ramp['named'])} cores com nome")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    try:
        main()
    except VendorError as error:
        print(f"vendor_lpc: {error}", file=sys.stderr)
        sys.exit(1)
