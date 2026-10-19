import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { MapError, parseOfficeMap, type OfficeMap } from "@workforces/protocol";
import { ServerConfigError } from "../config.js";

export interface LoadedMap {
  map: OfficeMap;
  /** O .tmj como está no disco: o navegador desenha a partir dele. */
  raw: Buffer;
  /** A imagem do tileset (`map.tilesetImage`), lida da pasta do mapa. */
  image: Buffer;
}

/** Lê e confere o mapa na subida: um mapa que o escritório não sabe usar impede o servidor de subir. */
export function loadMap(file: string): LoadedMap {
  let raw: Buffer;
  try {
    raw = readFileSync(file);
  } catch (error) {
    throw new ServerConfigError(`não consegui ler o mapa ${file}: ${(error as Error).message}`);
  }
  let map: OfficeMap;
  try {
    map = parseOfficeMap(JSON.parse(raw.toString("utf8").replace(/^﻿/, "")));
  } catch (error) {
    if (error instanceof SyntaxError) throw new ServerConfigError(`mapa inválido (${file}): não é um JSON válido`);
    if (error instanceof MapError) throw new ServerConfigError(`mapa inválido (${file}): ${error.message}`);
    throw error;
  }
  let image: Buffer;
  try {
    image = readFileSync(join(dirname(file), map.tilesetImage));
  } catch {
    throw new ServerConfigError(`imagem do tileset não encontrada: ${map.tilesetImage} (precisa ficar ao lado de ${file})`);
  }
  return { map, raw, image };
}
