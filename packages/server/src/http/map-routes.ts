import { extname } from "node:path";
import type { FastifyInstance } from "fastify";
import type { LoadedMap } from "../map/load-map.js";

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

/** O mapa e a imagem do tileset; nenhum outro arquivo da pasta do mapa é servido. */
export function registerMapRoutes(app: FastifyInstance, office: LoadedMap): void {
  const imageType = IMAGE_TYPES[extname(office.map.tilesetImage).toLowerCase()];
  app.get("/map/map.tmj", async (_request, reply) => reply.type("application/json; charset=utf-8").header("cache-control", "no-cache").send(office.raw));
  app.get<{ Params: { file: string } }>("/map/:file", async (request, reply) => {
    if (request.params.file !== office.map.tilesetImage || !imageType) return reply.code(404).send({ error: "não encontrado" });
    return reply.type(imageType).header("cache-control", "no-cache").send(office.image);
  });
}
