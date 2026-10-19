import { z } from "zod";

/** Até 3 robôs por mesa (spec 8); do quarto em diante o cliente mostra "+N". */
export const MAX_ROBOT_SLOTS = 3;
/** Id de mesa: é o nome do objeto `desk` no Tiled e vai para o banco (`users.desk_id`). */
export const DESK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** A imagem do tileset fica na mesma pasta do .tmj: só o nome do arquivo, sem caminho. */
const IMAGE_NAME_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DeskSpot {
  id: string;
  /** Zona de proximidade, em pixels do mapa. */
  zone: Rect;
  /** Onde os robôs dos agentes aparecem (centro de cada um). */
  slots: Point[];
}

export interface OfficeMap {
  tileSize: number;
  cols: number;
  rows: number;
  widthPx: number;
  heightPx: number;
  backgroundColor: string | null;
  spawn: Point;
  /** Na ordem do mapa: é a ordem em que as mesas são atribuídas. */
  desks: DeskSpot[];
  /** Nome do arquivo da imagem do tileset, ao lado do .tmj. */
  tilesetImage: string;
}

export class MapError extends Error {}

const Property = z.object({ name: z.string(), value: z.unknown() });
const MapObject = z.object({
  id: z.number(),
  name: z.string().optional(),
  type: z.string().optional(),
  class: z.string().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  properties: z.array(Property).optional(),
});
type MapObject = z.infer<typeof MapObject>;
const TileLayer = z.object({
  type: z.literal("tilelayer"),
  name: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  data: z.array(z.number().int().min(0)),
});
const ObjectLayer = z.object({ type: z.literal("objectgroup"), name: z.string(), objects: z.array(MapObject) });
const Tileset = z.object({ firstgid: z.number().int().min(1), name: z.string(), image: z.string(), tilewidth: z.number().int(), tileheight: z.number().int() });
const TiledMap = z.object({
  orientation: z.literal("orthogonal"),
  infinite: z.boolean().optional(),
  width: z.number().int().min(1).max(1000),
  height: z.number().int().min(1).max(1000),
  tilewidth: z.number().int().min(1).max(256),
  tileheight: z.number().int().min(1).max(256),
  backgroundcolor: z.string().optional(),
  layers: z.array(z.discriminatedUnion("type", [TileLayer, ObjectLayer])),
  tilesets: z.array(z.unknown()),
});

// Tiled 1.9 gravava o tipo do objeto em "class"; as outras versões, em "type".
const kindOf = (object: MapObject) => object.type || object.class || "";

/** Confere o .tmj e extrai o que o escritório usa. Lança MapError com o motivo. */
export function parseOfficeMap(raw: unknown): OfficeMap {
  const parsed = TiledMap.safeParse(raw);
  if (!parsed.success) {
    throw new MapError(`formato não suportado: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  const tiled = parsed.data;
  if (tiled.infinite) throw new MapError("mapa infinito não é suportado");
  if (tiled.tilewidth !== tiled.tileheight) throw new MapError("os tiles precisam ser quadrados");
  const tileSize = tiled.tilewidth;
  const widthPx = tiled.width * tileSize;
  const heightPx = tiled.height * tileSize;

  if (tiled.tilesets.length !== 1) throw new MapError("o mapa precisa ter exatamente um tileset");
  const tilesetImage = readTileset(tiled.tilesets[0], tileSize);

  for (const layer of tiled.layers) {
    if (layer.type === "tilelayer" && (layer.width !== tiled.width || layer.height !== tiled.height || layer.data.length !== tiled.width * tiled.height)) {
      throw new MapError(`camada ${layer.name} com tamanho diferente do mapa`);
    }
  }

  const objects = tiled.layers.flatMap((layer) => (layer.type === "objectgroup" ? layer.objects : []));
  const insidePoint = (point: Point) => point.x >= 0 && point.y >= 0 && point.x <= widthPx && point.y <= heightPx;
  const insideRect = (rect: Rect) => rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= widthPx && rect.y + rect.height <= heightPx;

  const spawnObject = objects.find((object) => kindOf(object) === "spawn");
  if (!spawnObject) throw new MapError("o mapa precisa de um objeto de entrada (tipo spawn)");
  const spawn = { x: spawnObject.x, y: spawnObject.y };
  if (!insidePoint(spawn)) throw new MapError("entrada fora do mapa");

  const desks: DeskSpot[] = [];
  for (const object of objects.filter((candidate) => kindOf(candidate) === "desk")) {
    const id = object.name ?? "";
    if (!DESK_ID_PATTERN.test(id)) throw new MapError(`mesa com nome inválido: "${id}" (use letras minúsculas, números e hífen)`);
    if (desks.some((desk) => desk.id === id)) throw new MapError(`mesa repetida: ${id}`);
    const zone = { x: object.x, y: object.y, width: object.width ?? 0, height: object.height ?? 0 };
    if (zone.width <= 0 || zone.height <= 0) throw new MapError(`mesa ${id} precisa ser um retângulo`);
    if (!insideRect(zone)) throw new MapError(`mesa ${id} fora do mapa`);
    desks.push({ id, zone, slots: [] });
  }

  for (const object of objects.filter((candidate) => kindOf(candidate) === "robot")) {
    const deskId = object.properties?.find((property) => property.name === "desk")?.value;
    const desk = desks.find((candidate) => candidate.id === deskId);
    if (!desk) throw new MapError(`robô aponta para uma mesa que não existe: ${String(deskId)}`);
    if (desk.slots.length >= MAX_ROBOT_SLOTS) throw new MapError(`mesa ${desk.id} tem mais de ${MAX_ROBOT_SLOTS} posições de robô`);
    const slot = { x: object.x, y: object.y };
    if (!insidePoint(slot)) throw new MapError(`robô da mesa ${desk.id} fora do mapa`);
    desk.slots.push(slot);
  }

  const backgroundColor = tiled.backgroundcolor && COLOR_PATTERN.test(tiled.backgroundcolor) ? tiled.backgroundcolor : null;
  return { tileSize, cols: tiled.width, rows: tiled.height, widthPx, heightPx, backgroundColor, spawn, desks, tilesetImage };
}

function readTileset(value: unknown, tileSize: number): string {
  if (typeof value === "object" && value !== null && "source" in value) {
    throw new MapError("tileset externo (.tsx) não é suportado: no Tiled, embuta o tileset no mapa");
  }
  const result = Tileset.safeParse(value);
  if (!result.success) throw new MapError("tileset inválido");
  const tileset = result.data;
  if (tileset.tilewidth !== tileSize || tileset.tileheight !== tileSize) throw new MapError(`tileset ${tileset.name} com tiles de outro tamanho`);
  if (!IMAGE_NAME_PATTERN.test(tileset.image)) {
    throw new MapError(`a imagem do tileset ${tileset.name} precisa ficar na pasta do mapa (só o nome do arquivo): ${tileset.image}`);
  }
  return tileset.image;
}

/** Ponto dentro do retângulo, com folga (em px) para todos os lados. */
export function inZone(zone: Rect, point: Point, slack = 0): boolean {
  return (
    point.x >= zone.x - slack &&
    point.x <= zone.x + zone.width + slack &&
    point.y >= zone.y - slack &&
    point.y <= zone.y + zone.height + slack
  );
}

/** Primeira mesa (na ordem do mapa) cuja zona contém o ponto, sem folga. */
export function deskAt(map: OfficeMap, point: Point): DeskSpot | null {
  return map.desks.find((desk) => inZone(desk.zone, point)) ?? null;
}
