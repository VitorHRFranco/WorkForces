"""O catálogo do personagem e os arquivos do LPC Revised que o projeto usa.

Uma fonte só para `vendor_lpc.py` (que copia os arquivos para assets/lpc/) e para `build_art.py` (que gera a arte a partir
deles). As pastas e as cores foram conferidas no commit fixado abaixo.
"""

LPC_COMMIT = "f07f7f5892e67c932c68f70bb04472f2c64e46bc"

BODIES = {"feminine": "Feminine, Thin", "masculine": "Masculine, Thin"}

# Cores com nome de cada família de rampa, como as subpastas de cor do LPC. As peles de fantasia (_Alternate Colors) ficam de fora.
SKINS = ["Bronze", "Brown", "Coffee", "Honey", "Ivory", "Peach", "Porcelain", "Tan", "Tawny"]
HAIR_COLORS = [
    "Ash Brown", "Black", "Blonde", "Blue", "Brown", "Charcoal", "Chestnut", "Gray", "Green", "Orange",
    "Pink", "Platinum", "Purple", "Raven", "Red", "Ruby", "Silver", "Teal", "Violet", "White",
]
CLOTHING_COLORS = [
    "Aegean", "Amber", "Amethyst", "Apple", "Apricot", "Azure", "Beige", "Black", "Blue", "Blue Violet",
    "Bronze", "Brown", "Cerise", "Cerulean", "Charcoal", "Chocolate", "Coffee", "Coral", "Cornflower", "Cyan",
    "Denim", "Dove", "Emerald", "Fern", "Forest", "Garnet", "Gray", "Green", "Heather", "Honey",
    "Ice", "Indigo", "Ivory", "Lavender", "Leather", "Lemon", "Linen", "Mauve", "Midnight", "Mint",
    "Mustard", "Navy", "Neptune", "Oak", "Ochre", "Olivine", "Orange", "Peach", "Pearl", "Periwinkle",
    "Pink", "Plum", "Porcelain", "Powder", "Purple", "Red", "Red Orange", "Royal", "Salmon", "Sepia",
    "Shadow", "Silver", "Sky", "Smoke", "Soot", "Spring", "Swamp", "Tan", "Tawny", "Teal",
    "Tumeric", "Umber", "White", "Wine", "Yellow",
]
METALS = ["Brass", "Bronze", "Copper", "Gold", "Iron", "Silver", "Steel"]

# Família de rampa: a cor de referência (a que vai para assets/lpc/), as cores com nome e a peça de amostra de onde as
# rampas saem (comparando a amostra em todas as cores).
FAMILIES = {
    "skin": {"reference": "Peach", "colors": SKINS, "probes": ["Characters/Body/Body 02 - Masculine, Thin", "Characters/Head/Head 02 - Masculine"]},
    "hair": {"reference": "Brown", "colors": HAIR_COLORS, "probes": ["Characters/Hair/Short 02 - Parted"]},
    "clothing": {"reference": "Cornflower", "colors": CLOTHING_COLORS, "probes": ["Characters/Clothing/Masculine, Thin/Torso/Shirt 04 - T-shirt"]},
    "metal": {"reference": "Steel", "colors": METALS, "probes": ["Characters/Head Accessories/Eyewear 01 - Glasses"]},
}

ANIMS = ["Walk", "Idle", "Sitting"]


def _clothing(part):
    """Pasta de uma roupa: depende do corpo ({body} vira o nome da pasta do corpo)."""
    return "Characters/Clothing/{body}/" + part


# Uma entrada por peça: id, família e pasta no LPC. "{body}" na pasta marca a peça que depende do corpo (uma pasta por corpo).
# "behind": a peça tem a camada _Behind (desenhada antes do corpo).
PIECES = [
    {"id": "body", "family": "skin", "folder": "Characters/Body/{body_folder}"},
    {"id": "head", "family": "skin", "folder": "Characters/Head/{head_folder}"},
    *[{"id": f"medium-{n:02}", "family": "hair", "folder": f"Characters/Hair/Medium {n:02} - {name}", "behind": n in (1, 2)}
      for n, name in enumerate(["Page", "Curly", "Idol", "Bangs & Bun", "Cornrows", "Dreadlocks", "Bob, Side Part",
                                "Bob, Bangs", "Twists", "Twists, Fade"], start=1)],
    *[{"id": f"short-{n:02}", "family": "hair", "folder": f"Characters/Hair/Short {n:02} - {name}"}
      for n, name in enumerate(["Buzzcut", "Parted", "Curly", "Cowlick", "Natural", "Balding", "Flat Top", "Flat Top, Fade"], start=1)],
    *[{"id": f"facial-{n:02}", "family": "hair", "folder": f"Characters/Hair/Facial Hair {n:02} - {name}"}
      for n, name in enumerate(["Walrus Mustache", "Chevron Mustache", "Handlebar Mustache", "Lampshade Mustache",
                                "Horseshoe Mustache", "Trimmed Beard", "Medium Beard"], start=1)],
    {"id": "brows-01", "family": "hair", "folder": "Characters/Hair/Eyebrows 01 - Thin Eyebrows"},
    {"id": "brows-02", "family": "hair", "folder": "Characters/Hair/Eyebrows 02 - Thick Eyebrows"},
    *[{"id": f"shirt-{n:02}", "family": "clothing", "folder": _clothing(f"Torso/Shirt {n:02} - {name}")}
      for n, name in enumerate(["Longsleeve Shirt", "V-neck Longsleeve Shirt", "Scoop Longsleeve Shirt", "T-shirt",
                                "V-neck T-shirt", "Scoop T-shirt", "Buttoned Longsleeve Shirt", "Buttoned T-shirt", "Polo"], start=1)],
    {"id": "cardigan", "family": "clothing", "folder": _clothing("Torso 2/Sweater 01 - Cardigan")},
    {"id": "suspenders", "family": "clothing", "folder": _clothing("Torso 2/Accessory 01 - Suspenders")},
    *[{"id": f"pants-{n:02}", "family": "clothing", "folder": _clothing(f"Legs/Pants {n:02} - {name}")}
      for n, name in enumerate(["Hose", "Leggings", "Pants", "Cuffed Pants", "Overalls"], start=1)],
    {"id": "shorts-01", "family": "clothing", "folder": _clothing("Legs/Shorts 01 - Shorts")},
    {"id": "shorts-02", "family": "clothing", "folder": _clothing("Legs/Shorts 02 - Short Shorts")},
    {"id": "shoes", "family": "clothing", "folder": _clothing("Feet/Shoes 01 - Shoes")},
    {"id": "boots", "family": "clothing", "folder": _clothing("Feet/Shoes 02 - Boots")},
    {"id": "socks-ankle", "family": "clothing", "folder": _clothing("Feet/Socks 01 - Ankle Socks")},
    {"id": "socks-high", "family": "clothing", "folder": _clothing("Feet/Socks 02 - High Socks")},
    {"id": "bowtie", "family": "clothing", "folder": _clothing("Accessories/Neckwear 01 - Bowtie")},
    {"id": "glasses-01", "family": "metal", "folder": "Characters/Head Accessories/Eyewear 01 - Glasses"},
    {"id": "glasses-02", "family": "metal", "folder": "Characters/Head Accessories/Eyewear 02 - Halfmoon Glasses"},
]

# Pasta do corpo e da cabeça de cada corpo.
BODY_FOLDERS = {"feminine": "Body 01 - Feminine, Thin", "masculine": "Body 02 - Masculine, Thin"}
HEAD_FOLDERS = {"feminine": "Head 01 - Feminine", "masculine": "Head 02 - Masculine"}


def piece_folders(piece):
    """As pastas de uma peça: {corpo: pasta} para as que dependem do corpo, {None: pasta} para as outras."""
    folder = piece["folder"]
    if not any(key in folder for key in ("{body}", "{body_folder}", "{head_folder}")):
        return {None: folder}
    return {
        body: folder.format(body=BODIES[body], body_folder=BODY_FOLDERS[body], head_folder=HEAD_FOLDERS[body])
        for body in BODIES
    }


# Os móveis e tiles que build_art.py usa (o gerador só pode pedir estes arquivos ou os das peças).
STATIC_FILES = [
    "Structure/Floor/Wood Floor A.png",
    "Structure/Floor/Geometric Carpet C.png",
    "Structure/Floor/Tile A.png",
    "Structure/Walls/Grainy Plain Wall.png",
    "Structure/Walls/Half-Wall Paneling A.png",
    "Structure/Wall Borders/Plain Smooth Border.png",
    "Objects/Furniture/Desk, Office.png",
    "Objects/Small Items/Laptop.png",
    "Objects/Furniture/Seating/Chair, Office.png",
    "Objects/Furniture/Planter.png",
    "Objects/Furniture/Table, Card.png",
    "Objects/Wall Items/Paintings, Abstract.png",
    "Objects/Wall Items/Posters.png",
    "Objects/Furniture/Cabinet.png",
    "Objects/Furniture/Seating/Sofa, Casual A.png",
    "Objects/Furniture/Seating/Chair, Sofa A.png",
    "Objects/Furniture/Table, Ornate Wood.png",
    "Objects/Furniture/Lighting, Floor.png",
    "Objects/Furniture/Water Cooler.png",
    "Objects/Furniture/Copy Machine.png",
    "Objects/Furniture/Vending Machine.png",
    "Objects/Furniture/TV, Widescreen.png",
]

PALETTE_FILE = "_ Palette/palette.json"


def piece_files(piece):
    """Os arquivos da peça na cor de referência: {(corpo, camada): [caminhos, um por pose]}; camada é "" ou "_Behind"."""
    reference = FAMILIES[piece["family"]]["reference"]
    files = {}
    for body, folder in piece_folders(piece).items():
        layers = [""] + (["_Behind"] if piece.get("behind") else [])
        for layer in layers:
            base = f"{folder}/{layer}/{reference}" if layer else f"{folder}/{reference}"
            files[(body, layer)] = [f"{base}/{anim}.png" for anim in ANIMS]
    return files
