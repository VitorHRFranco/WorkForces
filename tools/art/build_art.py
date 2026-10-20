#!/usr/bin/env python3
"""Gera a arte do escritório a partir do LPC Revised (OGA-BY 3.0; créditos em assets/CREDITS.md).

Uso, na raiz do repositório (precisa de Python 3.10+ e Pillow):
    python tools/art/build_art.py          # refaz as imagens e o props.json
    python tools/art/build_art.py --map    # também reescreve assets/map/office.tmj (perde edições feitas no Tiled)

Os arquivos do LPC são baixados uma vez, do commit fixado abaixo, para tools/art/.cache/ (fora do git).
"""
import argparse
import json
import os
import urllib.parse
import urllib.request

from PIL import Image

LPC_COMMIT = "f07f7f5892e67c932c68f70bb04472f2c64e46bc"
RAW = f"https://raw.githubusercontent.com/ElizaWy/LPC/{LPC_COMMIT}/"
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache", LPC_COMMIT[:12])
T = 32
WALL_FILL = (58, 52, 70, 255)  # #3a3446, por baixo das bordas do topo da parede
BACKGROUND = "#2e2a3a"


def lpc(path):
    """Abre um arquivo do LPC (baixa para o cache na primeira vez)."""
    local = os.path.join(CACHE, *path.split("/"))
    if not os.path.exists(local):
        os.makedirs(os.path.dirname(local), exist_ok=True)
        with urllib.request.urlopen(RAW + urllib.parse.quote(path), timeout=60) as response:
            data = response.read()
        with open(local + ".part", "wb") as out:
            out.write(data)
        os.replace(local + ".part", local)
    return Image.open(local).convert("RGBA")


def trim(image):
    box = image.getchannel("A").getbbox()
    return image.crop(box) if box else image


# ---------------------------------------------------------------- tileset (assets/map/office.png)

BORDER = {  # peças do "Plain Smooth Border" sobre o preenchimento do topo da parede
    "top-v-top": (0, 0, 32, 32),
    "top-v-mid": (0, 32, 32, 64),
    "top-v-bot": (0, 64, 32, 96),
    "top-h-left": (32, 96, 64, 128),
    "top-h-mid": (64, 96, 96, 128),
    "top-h-right": (96, 96, 128, 128),
    "top-single": (0, 96, 32, 128),
}
TILE_NAMES = (
    ["wood-0", "wood-1", "wood-2", "carpet", "tile"]
    + [f"face-top-{i}" for i in range(3)]
    + [f"face-bottom-{i}" for i in range(3)]
    + list(BORDER)
)
TILE_COLUMNS = 8


def build_tileset():
    tiles = {}
    wood = lpc("Structure/Floor/Wood Floor A.png").crop((96, 0, 128, 96))
    for i in range(3):
        tiles[f"wood-{i}"] = wood.crop((0, 32 * i, 32, 32 * i + 32))
    tiles["carpet"] = lpc("Structure/Floor/Geometric Carpet C.png").crop((160, 0, 192, 32))
    tiles["tile"] = lpc("Structure/Floor/Tile A.png").crop((32, 0, 64, 32))
    grain = lpc("Structure/Walls/Grainy Plain Wall.png")
    face = Image.new("RGBA", (96, 64))
    face.alpha_composite(grain.crop((0, 0, 96, 32)), (0, 0))
    face.alpha_composite(grain.crop((0, 64, 96, 96)), (0, 32))
    face.alpha_composite(lpc("Structure/Walls/Half-Wall Paneling A.png").crop((96, 32, 192, 64)), (0, 32))
    for i in range(3):
        tiles[f"face-top-{i}"] = face.crop((32 * i, 0, 32 * i + 32, 32))
        tiles[f"face-bottom-{i}"] = face.crop((32 * i, 32, 32 * i + 32, 64))
    border = lpc("Structure/Wall Borders/Plain Smooth Border.png")
    for name, box in BORDER.items():
        tile = Image.new("RGBA", (T, T), WALL_FILL)
        tile.alpha_composite(border.crop(box))
        tiles[name] = tile
    rows = (len(TILE_NAMES) + TILE_COLUMNS - 1) // TILE_COLUMNS
    sheet = Image.new("RGBA", (TILE_COLUMNS * T, rows * T))
    for index, name in enumerate(TILE_NAMES):
        sheet.alpha_composite(tiles[name], ((index % TILE_COLUMNS) * T, (index // TILE_COLUMNS) * T))
    return sheet


# ---------------------------------------------------------------- props (sprites/props.png + props.json)
# Cada prop: imagem recortada e "solid" = [esquerda, topo, largura, altura] relativo à âncora
# (centro da base da imagem), ou None quando não bloqueia a passagem.


def composite(size, parts):
    canvas = Image.new("RGBA", size)
    for image, at in parts:
        canvas.alpha_composite(image, at)
    return trim(canvas)


def build_props():
    furniture = "Objects/Furniture/"
    desk = lpc(furniture + "Desk, Office.png")
    laptop = lpc("Objects/Small Items/Laptop.png")
    chair = lpc(furniture + "Seating/Chair, Office.png")
    planter = lpc(furniture + "Planter.png")
    card = lpc(furniture + "Table, Card.png")
    paint = lpc("Objects/Wall Items/Paintings, Abstract.png")
    posters = lpc("Objects/Wall Items/Posters.png")
    table_left, table_mid, table_right = (card.crop((x, 128, x + 32, 189)) for x in (0, 32, 64))
    props = {
        "desk-wood": (composite((64, 64), [(desk.crop((128, 64, 192, 128)), (0, 0)), (laptop.crop((32, 0, 64, 32)), (16, 2))]), [-29, -21, 58, 21]),
        "desk-white": (composite((64, 64), [(desk.crop((64, 64, 128, 128)), (0, 0)), (laptop.crop((96, 0, 128, 32)), (16, 2))]), [-29, -21, 58, 21]),
        "chair-back": (trim(chair.crop((0, 0, 32, 34))), None),  # vista de costas: quem senta olha para cima
        "chair-front": (trim(chair.crop((0, 40, 32, 82))), None),  # vista de frente, com o assento à mostra
        "plant-tree": (trim(planter.crop((64, 0, 96, 84))), [-10, -12, 20, 12]),
        "plant-fern": (trim(planter.crop((128, 34, 160, 84))), [-10, -10, 20, 10]),
        "bookcase": (trim(lpc(furniture + "Cabinet.png").crop((64, 96, 128, 172))), [-32, -16, 64, 16]),
        "sofa": (trim(lpc(furniture + "Seating/Sofa, Casual A.png").crop((320, 0, 416, 64))), [-46, -20, 92, 20]),
        "armchair-back": (trim(lpc(furniture + "Seating/Chair, Sofa A.png").crop((96, 96, 128, 128))), [-12, -10, 24, 10]),
        "coffee-table": (trim(lpc(furniture + "Table, Ornate Wood.png").crop((8, 35, 56, 60))), [-22, -12, 44, 12]),
        "floor-lamp": (trim(lpc(furniture + "Lighting, Floor.png").crop((0, 0, 32, 54))), [-6, -6, 12, 6]),
        "water-cooler": (trim(lpc(furniture + "Water Cooler.png").crop((0, 0, 32, 64))), [-10, -10, 20, 10]),
        "copier": (trim(lpc(furniture + "Copy Machine.png").crop((0, 0, 64, 64))), [-28, -18, 56, 18]),
        "vending": (trim(lpc(furniture + "Vending Machine.png").crop((16, 0, 56, 64))), [-20, -20, 40, 20]),
        "tv": (trim(lpc(furniture + "TV, Widescreen.png").crop((230, 0, 316, 64))), None),
        "painting-a": (trim(paint.crop((35, 3, 94, 46))), None),
        "painting-b": (trim(paint.crop((141, 1, 180, 32))), None),
        "poster-a": (trim(posters.crop((3, 39, 27, 75))), None),
        "poster-b": (trim(posters.crop((67, 35, 94, 75))), None),
        "meeting-table": (composite((160, 61), [(piece, (32 * i, 0)) for i, piece in enumerate([table_left, table_mid, table_mid, table_mid, table_right])]), [-80, -23, 160, 23]),
    }
    return props


def pack(images, width=512, pad=2):
    """Empacota em prateleiras (mais altos primeiro). Devolve (atlas, {nome: (x, y, w, h)})."""
    x = y = shelf = 0
    places = {}
    for name, image in sorted(images.items(), key=lambda item: (-item[1].size[1], item[0])):
        w, h = image.size
        if x + w > width:
            x, y, shelf = 0, y + shelf + pad, 0
        places[name] = (x, y, w, h)
        x += w + pad
        shelf = max(shelf, h)
    atlas = Image.new("RGBA", (width, y + shelf))
    for name, (px, py, _, _) in places.items():
        atlas.alpha_composite(images[name], (px, py))
    return atlas, places


# ---------------------------------------------------------------- pessoas (sprites/people.png)
# Uma faixa de 64 px de altura x 4 linhas por variante. Colunas: 0-7 andando, 8-10 parado, 11 sentado
# (coluna 2 do Sitting.png do LPC: sentado numa cadeira). Linhas: 0 cima, 1 esquerda, 2 baixo, 3 direita.

PEOPLE = [  # (corpo, pele, cabelo, cor do cabelo, camisa, cor, calça, cor)
    ("m", "Peach", "Short 02 - Parted", "Brown", "Shirt 09 - Polo", "Cornflower", "Pants 03 - Pants", "Denim"),
    ("f", "Bronze", "Medium 07 - Bob, Side Part", "Black", "Shirt 07 - Buttoned Longsleeve Shirt", "Coral", "Pants 03 - Pants", "Charcoal"),
    ("m", "Coffee", "Short 05 - Natural", "Black", "Shirt 04 - T-shirt", "Emerald", "Pants 03 - Pants", "Charcoal"),
    ("f", "Peach", "Medium 03 - Idol", "Blonde", "Shirt 04 - T-shirt", "Lavender", "Pants 03 - Pants", "Denim"),
    ("m", "Tan", "Short 04 - Cowlick", "Chestnut", "Shirt 08 - Buttoned T-shirt", "Amber", "Pants 04 - Cuffed Pants", "Charcoal"),
    ("f", "Honey", "Medium 02 - Curly", "Raven", "Shirt 05 - V-neck T-shirt", "Cerulean", "Pants 02 - Leggings", "Black"),
    ("m", "Ivory", "Short 07 - Flat Top", "Black", "Shirt 01 - Longsleeve Shirt", "Charcoal", "Pants 03 - Pants", "Beige"),
    ("f", "Brown", "Medium 09 - Twists", "Black", "Shirt 06 - Scoop T-shirt", "Cerise", "Pants 03 - Pants", "Denim"),
    ("m", "Porcelain", "Short 03 - Curly", "Orange", "Shirt 09 - Polo", "Apple", "Pants 03 - Pants", "Charcoal"),
    ("f", "Tawny", "Medium 04 - Bangs & Bun", "Brown", "Shirt 02 - V-neck Longsleeve Shirt", "Azure", "Pants 04 - Cuffed Pants", "Charcoal"),
    ("m", "Brown", "Medium 06 - Dreadlocks", "Black", "Shirt 04 - T-shirt", "Amber", "Pants 03 - Pants", "Denim"),
    ("f", "Porcelain", "Medium 08 - Bob, Bangs", "Pink", "Shirt 09 - Polo", "Aegean", "Pants 03 - Pants", "Black"),
]
HAIR_BEHIND = {"Medium 02 - Curly"}  # estilos com a camada _Behind (desenhada antes do corpo)


def person(variant, anim):
    kind, skin, hair, hair_color, shirt, shirt_color, pants, pants_color = variant
    body = "Body 02 - Masculine, Thin" if kind == "m" else "Body 01 - Feminine, Thin"
    head = "Head 02 - Masculine" if kind == "m" else "Head 01 - Feminine"
    clothing = "Characters/Clothing/" + ("Masculine, Thin" if kind == "m" else "Feminine, Thin")
    layers = []
    if hair in HAIR_BEHIND:
        layers.append(f"Characters/Hair/{hair}/_Behind/{hair_color}")
    layers += [
        f"Characters/Body/{body}/{skin}",
        f"{clothing}/Feet/Shoes 01 - Shoes/Black",
        f"{clothing}/Legs/{pants}/{pants_color}",
        f"{clothing}/Torso/{shirt}/{shirt_color}",
        f"Characters/Head/{head}/{skin}",
        f"Characters/Hair/{hair}/{hair_color}",
    ]
    out = None
    for layer in layers:
        image = lpc(f"{layer}/{anim}.png")
        out = out or Image.new("RGBA", image.size)
        out.alpha_composite(image)
    return out


def build_people():
    sheet = Image.new("RGBA", (12 * 64, len(PEOPLE) * 256))
    for index, variant in enumerate(PEOPLE):
        top = index * 256
        sheet.alpha_composite(person(variant, "Walk"), (0, top))
        sheet.alpha_composite(person(variant, "Idle"), (8 * 64, top))
        sheet.alpha_composite(person(variant, "Sitting").crop((128, 0, 192, 256)), (11 * 64, top))
    return sheet


# ---------------------------------------------------------------- robô (sprites/robot.png), desenho próprio

ROBOT = [
    "...........kk...........",
    "..........kaak..........",
    "..........kaAk..........",
    "...........kk...........",
    "...........kk...........",
    "....kkkkkkkkkkkkkkkk....",
    "...kLLLLLLLLLLLLLLMDk...",
    "...kLLkkkkkkkkkkkLMDk...",
    "...kLkssssssssssskMDk...",
    "...kLksseessseesskMDk...",
    "...kLksseessseesskMDk...",
    "...kLkssssssssssskMDk...",
    "...kLksssshhhsssskMDk...",
    "...kLLkkkkkkkkkkkLMDk...",
    "...kMMMMMMMMMMMMMMMDk...",
    "....kkkkkkkkkkkkkkkk....",
    ".......kDDDDDDDDDk......",
    "....kkkLLLLLLLLLLLkkk...",
    "...kMMkLLLLaaaLLLLkMMk..",
    "...kMMkLLLLaAaLLLMkMMk..",
    "...kMMkLLLLLLLLLLMkMMk..",
    "...kDDkLLLLLLLLLMMkDDk..",
    "....kk.kMMMMMMMMMk.kk...",
    ".......kDDDDDDDDDk......",
    "......kkkk.....kkkk.....",
    "......kDDk.....kDDk.....",
    "......kkkk.....kkkk.....",
    "........................",
]
ROBOT_COLORS = {
    "k": "#2a2238", "L": "#e8eef2", "M": "#b3c2cf", "D": "#7b8ba3",
    "s": "#1c2a44", "e": "#7ae8ff", "h": "#7ae8ff", "a": "#f07a55", "A": "#b84a3a",
}


def robot_frame(blink):
    colors = dict(ROBOT_COLORS)
    rows = list(ROBOT)
    if blink:  # olhos fechados e a luz da antena trocada
        colors["a"], colors["A"] = colors["A"], "#ffd27a"
        rows[9] = "...kLkssssssssssskMDk..."
        rows[10] = "...kLksseessseesskMDk..."
    image = Image.new("RGBA", (24, 28))
    for y, row in enumerate(rows):
        for x, char in enumerate(row):
            if char != ".":
                value = colors[char]
                image.putpixel((x, y), tuple(int(value[i:i + 2], 16) for i in (1, 3, 5)) + (255,))
    return image


def build_robot():
    sheet = Image.new("RGBA", (48, 28))
    sheet.alpha_composite(robot_frame(False), (0, 0))
    sheet.alpha_composite(robot_frame(True), (24, 0))
    return sheet


# ---------------------------------------------------------------- mapa (assets/map/office.tmj), só com --map

GW, GH = 26, 19
DOORS_X17 = (6, 7, 14, 15)  # passagens na parede vertical x=17
DOORS_Y9 = (23, 24)  # passagens na parede horizontal y=9


def desk_units():
    """Canto de cada mesa (ux, uy), na ordem dos ids mesa-1..mesa-8."""
    return [(40 + 120 * i, uy) for uy in (128, 352) for i in range(4)]


def build_map(tileset_size):
    gid = {name: index + 1 for index, name in enumerate(TILE_NAMES)}
    floor = [[0] * GW for _ in range(GH)]
    walls = [[0] * GW for _ in range(GH)]
    cells = {(x, y) for x in range(GW) for y in (0, GH - 1)} | {(x, y) for y in range(GH) for x in (0, GW - 1)}
    cells |= {(17, y) for y in range(GH) if y not in DOORS_X17}
    cells |= {(x, 9) for x in range(17, GW) if x not in DOORS_Y9}

    for y in range(1, GH - 1):
        for x in range(1, GW - 1):
            if (x, y) in cells:
                continue
            if x < 17 or (x == 17 and y in DOORS_X17):
                floor[y][x] = gid[f"wood-{y % 3}"]
            elif y < 9:
                floor[y][x] = gid["carpet"]
            else:
                floor[y][x] = gid["tile"]

    def face(x0, x1, y):
        for x in range(x0, x1):
            walls[y][x] = gid[f"face-top-{x % 3}"]
            walls[y + 1][x] = gid[f"face-bottom-{x % 3}"]

    face(1, 17, 1)
    face(18, 25, 1)
    face(18, 23, 10)

    for (x, y) in cells:
        n, s, e, w = (x, y - 1) in cells, (x, y + 1) in cells, (x + 1, y) in cells, (x - 1, y) in cells
        if (e or w) and not (n or s):
            name = "top-h-mid" if (e and w) else ("top-h-left" if e else "top-h-right")
        elif (n or s) and not (e or w):
            name = "top-v-mid" if (n and s) else ("top-v-top" if s else "top-v-bot")
        else:
            name = "top-single"
        walls[y][x] = gid[name]

    objects = []

    def add(kind, x, y, name="", width=0, height=0, **properties):
        item = {"id": len(objects) + 1, "name": name, "type": kind, "x": x, "y": y, "width": width, "height": height, "rotation": 0, "visible": True}
        if width == 0:
            item["point"] = True
        if properties:
            item["properties"] = [{"name": key, "type": "string", "value": value} for key, value in properties.items()]
        objects.append(item)

    add("spawn", 288, 304, "entrada")
    units = desk_units()
    for index, (ux, uy) in enumerate(units):
        add("desk", ux - 4, uy + 16, f"mesa-{index + 1}", 120, 88)
    for index, (ux, uy) in enumerate(units):
        for dx, dy in ((78, 58), (102, 72), (78, 88)):
            add("robot", ux + dx, uy + dy, desk=f"mesa-{index + 1}")
    seats = [(ux + 32, uy + 70, "up") for ux, uy in units]
    seats += [(630 + 36 * i, 446, "down") for i in range(4)]
    seats += [(630 + 36 * i, 516, "up") for i in range(4)]
    seats += [(626, 150, "down"), (670, 150, "down"), (618, 234, "up"), (678, 234, "up")]
    for x, y, direction in seats:
        add("seat", x, y, dir=direction)

    props = []
    for index, (ux, uy) in enumerate(units):
        props.append(("desk-wood" if index % 2 == (index // 4) % 2 else "desk-white", ux + 32, uy + 51))
        props.append(("chair-back", ux + 32, uy + 72))  # encostada na mesa, 2 px abaixo do assento
    props += [
        ("painting-a", 133, 77), ("poster-a", 368, 74), ("poster-b", 429, 76), ("painting-b", 627, 73),
        ("copier", 232, 106), ("water-cooler", 292, 104),
        ("plant-tree", 48, 126), ("plant-fern", 46, 572), ("plant-fern", 526, 572),
        ("bookcase", 752, 108), ("sofa", 648, 142), ("coffee-table", 648, 186), ("armchair-back", 618, 238),
        ("armchair-back", 678, 238), ("floor-lamp", 590, 136), ("plant-tree", 782, 282), ("vending", 778, 202),
        ("tv", 656, 369), ("meeting-table", 688, 478), ("plant-fern", 590, 572), ("plant-fern", 784, 572),
    ]
    props += [("chair-front", 630 + 36 * i, 442) for i in range(4)]
    props += [("chair-back", 630 + 36 * i, 518) for i in range(4)]
    for sprite, x, y in props:
        add("prop", x, y, sprite=sprite)

    layer = lambda layer_id, name, data, **extra: {
        "id": layer_id, "name": name, "type": "tilelayer", "x": 0, "y": 0, "width": GW, "height": GH,
        "opacity": 1, "visible": True, "data": [tile for row in data for tile in row], **extra,
    }
    width, height = tileset_size
    return {
        "type": "map", "version": "1.10", "tiledversion": "1.11.2", "orientation": "orthogonal", "renderorder": "right-down",
        "infinite": False, "width": GW, "height": GH, "tilewidth": T, "tileheight": T, "backgroundcolor": BACKGROUND,
        "nextlayerid": 4, "nextobjectid": len(objects) + 1,
        "tilesets": [{
            "firstgid": 1, "name": "lpc-office", "image": "office.png", "imagewidth": width, "imageheight": height,
            "tilewidth": T, "tileheight": T, "columns": TILE_COLUMNS, "tilecount": (width // T) * (height // T), "margin": 0, "spacing": 0,
        }],
        "layers": [
            layer(1, "floor", floor),
            layer(2, "walls", walls, properties=[{"name": "collides", "type": "bool", "value": True}]),
            {"id": 3, "name": "objects", "type": "objectgroup", "x": 0, "y": 0, "opacity": 1, "visible": True, "draworder": "topdown", "objects": objects},
        ],
    }


# ----------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--map", action="store_true", help="reescreve assets/map/office.tmj")
    parser.add_argument("--out", default=os.path.abspath(os.path.join(HERE, "..", "..")), help="raiz onde gravar (padrão: o repositório)")
    args = parser.parse_args()
    root = args.out
    map_dir = os.path.join(root, "assets", "map")
    sprites = os.path.join(root, "packages", "client", "public", "sprites")
    game = os.path.join(root, "packages", "client", "src", "game")
    for directory in (map_dir, sprites, game):
        os.makedirs(directory, exist_ok=True)

    tileset = build_tileset()
    tileset.save(os.path.join(map_dir, "office.png"), optimize=True)
    props = build_props()
    atlas, places = pack({name: image for name, (image, _) in props.items()})
    atlas.save(os.path.join(sprites, "props.png"), optimize=True)
    lines = [f'  "{name}": {json.dumps({"x": x, "y": y, "w": w, "h": h, "solid": props[name][1]})}' for name, (x, y, w, h) in sorted(places.items())]
    with open(os.path.join(game, "props.json"), "w", encoding="utf-8", newline="\n") as out:
        out.write("{\n" + ",\n".join(lines) + "\n}\n")
    build_people().save(os.path.join(sprites, "people.png"), optimize=True)
    build_robot().save(os.path.join(sprites, "robot.png"), optimize=True)
    if args.map:
        with open(os.path.join(map_dir, "office.tmj"), "w", encoding="utf-8", newline="\n") as out:
            json.dump(build_map(tileset.size), out, separators=(",", ":"))
            out.write("\n")
    print("arte gerada em", root)


if __name__ == "__main__":
    main()
