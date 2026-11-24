# Créditos dos assets

## LPC Revised (OGA-BY 3.0)

A arte do escritório vem do [LPC Revised](https://github.com/ElizaWy/LPC), no commit `f07f7f5892e67c932c68f70bb04472f2c64e46bc`, sob a licença [OGA-BY 3.0](https://static.opengameart.org/OGA-BY-3.0.txt) ([perguntas frequentes](https://opengameart.org/content/oga-by-30-faq)). Estes arquivos foram montados por `tools/art/build_art.py` a partir das peças listadas abaixo (recortes, camadas, empacotamento e troca de cores, sem redesenho) e continuam sob a OGA-BY 3.0:

- `assets/map/office.png`: piso, paredes e bordas;
- `packages/client/public/sprites/props.png`: móveis e decoração;
- `packages/client/public/sprites/parts/`: cada peça do personagem (corpo, cabeça, cabelos, barbas, roupas e acessórios) na cor de referência; o app troca as cores de cada peça pela cor que a pessoa escolhe e empilha as camadas;
- `packages/client/test/fixtures/people-legacy.png`: as 12 pessoas de antes, montadas em camadas, guardadas para o teste que confere a montagem.

Os arquivos originais que o projeto usa estão em `assets/lpc/`, sem modificação, no mesmo caminho do repositório de origem, junto com os `Credits.txt` de cada pasta (`assets/lpc/ORIGEM.md` diz de onde e quando vieram). Os créditos de cada peça vêm desses `Credits.txt`.

O LPC Revised é obra destes artistas, listados no `Credits.txt` da raiz da coleção: Eliza Wyatt (DeathsDarling), Lanea Zimmerman (Sharm), Stephen Challener (Redshrike), Johannes Sjölund (Wulax), BlueCarrot16, BenCreating, Durrani, YuriNikolai e Craftpix.net 2D Game Assets.

### Piso, paredes e bordas (`Structure/`)

| Peça | Artistas | Origem |
|---|---|---|
| Wood Floor A | Lanea Zimmerman (Sharm), Eliza Wyatt (DeathsDarling) | [LPC Modified Base Tiles](https://opengameart.org/content/lpc-modified-base-tiles) |
| Geometric Carpet C | Eliza Wyatt (DeathsDarling) ¹ | LPC Revised |
| Tile A | Eliza Wyatt (DeathsDarling) | LPC Revised |
| Grainy Plain Wall | Lanea Zimmerman (Sharm), Eliza Wyatt (DeathsDarling) | [LPC Arabic Elements](https://opengameart.org/content/lpc-arabic-elements) |
| Half-Wall Paneling A | Lanea Zimmerman (Sharm), Eliza Wyatt (DeathsDarling) | [LPC Interior Castle Tiles](https://opengameart.org/content/lpc-interior-castle-tiles) |
| Plain Smooth Border | Eliza Wyatt (DeathsDarling) | LPC Revised |

¹ O `Credits.txt` de `Structure/Floor` lista "Geometric Carpet A" e "Geometric Carpet B", ambos originais de Eliza Wyatt, mas não tem entrada para o "C", que é da mesma série.

### Móveis e decoração (`Objects/`)

| Peça | Artistas | Origem |
|---|---|---|
| Desk, Office | Lanea Zimmerman (Sharm), Eliza Wyatt (DeathsDarling) | [LPC Modified Base Tiles](https://opengameart.org/content/lpc-modified-base-tiles) |
| Laptop | Eliza Wyatt (DeathsDarling) | LPC Revised |
| Chair, Office | Eliza Wyatt (DeathsDarling) | LPC Revised |
| Chair, Sofa A | Lanea Zimmerman (Sharm), BlueCarrot16, Eliza Wyatt (DeathsDarling) | [LPC Upholstery](https://opengameart.org/content/lpc-upholstery) |
| Sofa, Casual A | Lanea Zimmerman (Sharm), BlueCarrot16, Eliza Wyatt (DeathsDarling) ² | [LPC Upholstery](https://opengameart.org/content/lpc-upholstery) |
| Cabinet | Lanea Zimmerman (Sharm), Eliza Wyatt (DeathsDarling) | [LPC Modified Base Tiles](https://opengameart.org/content/lpc-modified-base-tiles) |
| Copy Machine | Eliza Wyatt (DeathsDarling) | LPC Revised |
| Lighting, Floor | Lanea Zimmerman (Sharm), Eliza Wyatt (DeathsDarling) | [LPC Modified Base Tiles](https://opengameart.org/content/lpc-modified-base-tiles), [LPC Interior Castle Tiles](https://opengameart.org/content/lpc-interior-castle-tiles) |
| Planter | Lanea Zimmerman (Sharm), com cores de Eliza Wyatt (DeathsDarling) | [LPC Interior Castle Tiles](https://opengameart.org/content/lpc-interior-castle-tiles) |
| Table, Card | Eliza Wyatt (DeathsDarling) | LPC Revised |
| Table, Ornate Wood | Lanea Zimmerman (Sharm), Eliza Wyatt (DeathsDarling) | [LPC Interior Castle Tiles](https://opengameart.org/content/lpc-interior-castle-tiles) |
| TV, Widescreen | Eliza Wyatt (DeathsDarling) | LPC Revised |
| Vending Machine | Eliza Wyatt (DeathsDarling) | LPC Revised |
| Water Cooler | Eliza Wyatt (DeathsDarling) | LPC Revised |
| Paintings, Abstract | Eliza Wyatt (DeathsDarling) | LPC Revised |
| Posters | Eliza Wyatt (DeathsDarling) | LPC Revised |

² O `Credits.txt` de `Objects/Furniture/Seating` não tem entrada com esse nome. Os créditos acima juntam os das entradas da mesma série: "Sofa Set, Casual" (Eliza Wyatt) e "Loveseat, Casual (all)" (Lanea Zimmerman, BlueCarrot16 e Eliza Wyatt).

### Pessoas (`Characters/`)

Todas as roupas e todos os cabelos partem do corpo e das animações originais do LPC, de Stephen Challener (Redshrike), ampliados por Eliza Wyatt (DeathsDarling), Durrani e BenCreating.

| Peça | Artistas | Origem |
|---|---|---|
| Body 01 - Feminine, Thin | Stephen Challener (Redshrike), Eliza Wyatt (DeathsDarling) | [LPC Base Assets](https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles) |
| Body 02 - Masculine, Thin | Stephen Challener (Redshrike), Durrani, Eliza Wyatt (DeathsDarling), BenCreating | [LPC Base Assets](https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles), [LPC Jump Expanded](https://opengameart.org/content/lpc-jump-expanded) |
| Head 01 - Feminine e Head 02 - Masculine | Stephen Challener (Redshrike), Eliza Wyatt (DeathsDarling) | [LPC Base Assets](https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles) |
| Cabelos Short 01 - Buzzcut, Short 02 - Parted, Short 03 - Curly, Short 06 - Balding e Medium 02 - Curly | Eliza Wyatt (DeathsDarling) | LPC Revised |
| Cabelos Short 04 - Cowlick, Short 05 - Natural, Short 07 - Flat Top, Short 08 - Flat Top, Fade, Medium 04 - Bangs & Bun, Medium 05 - Cornrows, Medium 06 - Dreadlocks, Medium 08 - Bob, Bangs, Medium 09 - Twists e Medium 10 - Twists, Fade | BlueCarrot16 (original CC0), Eliza Wyatt (DeathsDarling) | [LPC Hair](https://opengameart.org/content/lpc-hair) |
| Cabelo Medium 07 - Bob, Side Part | Thecilekli (original CC0), BlueCarrot16, Eliza Wyatt (DeathsDarling) | [LPC Hair](https://opengameart.org/content/lpc-hair) |
| Cabelo Medium 03 - Idol | Thecilekli (original CC0), Eliza Wyatt (DeathsDarling) | [LPC Korean Idol Hairstyle](https://opengameart.org/content/lpc-korean-idol-hairstyle-male-with-12-colors) |
| Cabelo Medium 01 - Page | Johannes Sjölund (Wulax), Eliza Wyatt (DeathsDarling) | [LPC Medieval Fantasy Character Sprites](https://opengameart.org/content/lpc-medieval-fantasy-character-sprites) |
| Barbas e bigodes Facial Hair 01 a 07; sobrancelhas Eyebrows 01 e 02 | Coleção LPC Revised ³ | LPC Revised |
| Camisas Shirt 01 a 09; cardigã Sweater 01; suspensório Accessory 01; calças Pants 01 a 05; bermudas Shorts 01 e 02; sapatos Shoes 01 e 02; meias Socks 01 e 02; gravata Neckwear 01 - Bowtie (nos dois corpos) | Eliza Wyatt (DeathsDarling) | LPC Revised |
| Óculos Eyewear 01 - Glasses e Eyewear 02 - Halfmoon Glasses | Eliza Wyatt (DeathsDarling) | LPC Revised |

³ O `Credits.txt` de `Characters/Hair` não tem entrada para as barbas, os bigodes e as sobrancelhas. Ficam creditados à coleção LPC Revised e a todos os artistas dela, listados acima.

## Desenho próprio (PolyForm Internal Use 1.0.0, como o resto do repositório; veja o `LICENSE`)

- `packages/client/public/sprites/robot.png`: o robô dos agentes, desenhado pixel a pixel em `tools/art/build_art.py`.
- `assets/map/office.tmj`: o mapa do escritório, gerado por `tools/art/build_art.py --map` e editável no [Tiled](https://www.mapeditor.org/).
- `packages/client/src/game/props.json`: posição e área de colisão de cada móvel no atlas.
