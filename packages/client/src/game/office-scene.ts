import { deskAt, type Direction, type OfficeMap } from "@workforces/protocol";
import Phaser from "phaser";
import type { OfficeState } from "../office/office-state";
import { avatarFor } from "./avatar";
import type { MoveState } from "./move-sender";
import { Track } from "./track";

export const TILES_KEY = "tiles";
const MAP_KEY = "office";
/** Pixels por segundo. */
const SPEED = 80;
const ZOOM = 3;
/** Sprites ficam acima das camadas do mapa e se sobrepõem pela altura (y). */
const SPRITE_DEPTH = 100;
const LABEL_DEPTH = 10_000;

export interface OfficeSceneDeps {
  state: OfficeState;
  map: OfficeMap;
  /** O .tmj já baixado pela página (o mesmo que o servidor usa). */
  tiledJson: unknown;
  tilesUrl: string;
  onMove(state: MoveState): void;
  /** Mesa em cuja zona o avatar está (null fora de todas). */
  onZone(deskId: string | null): void;
}

interface Remote {
  sprite: Phaser.GameObjects.Sprite;
  name: Phaser.GameObjects.Text;
  track: Track;
}

type WasdKeys = Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;

export class OfficeScene extends Phaser.Scene {
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private nameTag!: Phaser.GameObjects.Text;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: WasdKeys;
  private readonly remotes = new Map<number, Remote>();
  private dir: Direction = "down";
  private zone: string | null = null;
  private keyboardWanted = true;

  constructor(private readonly deps: OfficeSceneDeps) {
    super("office");
  }

  preload(): void {
    const size = this.deps.map.tileSize;
    this.load.spritesheet(TILES_KEY, this.deps.tilesUrl, { frameWidth: size, frameHeight: size });
  }

  create(): void {
    const { map: office, state } = this.deps;
    this.cache.tilemap.add(MAP_KEY, { format: Phaser.Tilemaps.Formats.TILED_JSON, data: this.deps.tiledJson });
    const tilemap = this.make.tilemap({ key: MAP_KEY });
    const tileset = tilemap.addTilesetImage(tilemap.tilesets[0]!.name, TILES_KEY);
    const walls: Phaser.Tilemaps.TilemapLayer[] = [];
    for (const layerData of tilemap.layers) {
      const layer = tileset ? (tilemap.createLayer(layerData.name, tileset, 0, 0) as Phaser.Tilemaps.TilemapLayer | null) : null;
      const properties = (layerData.properties ?? []) as { name: string; value: unknown }[];
      if (layer && properties.some((property) => property.name === "collides" && property.value === true)) {
        layer.setCollisionByExclusion([-1]);
        walls.push(layer);
      }
    }

    const me = state.me!;
    const start = state.players.get(me.id) ?? office.spawn;
    const look = avatarFor(me.id);
    this.player = this.physics.add.sprite(start.x, start.y, TILES_KEY, look.frame).setTint(look.tint);
    this.player.body.setSize(10, 8).setOffset(3, 8);
    this.player.setCollideWorldBounds(true);
    this.physics.world.setBounds(0, 0, office.widthPx, office.heightPx);
    for (const layer of walls) this.physics.add.collider(this.player, layer);
    this.nameTag = this.label(me.name);

    this.cameras.main
      .setBounds(0, 0, office.widthPx, office.heightPx)
      .setZoom(ZOOM)
      .setRoundPixels(true)
      .startFollow(this.player, true);

    const keyboard = this.input.keyboard!;
    this.cursors = keyboard.createCursorKeys();
    // false: as letras não são capturadas pelo jogo e continuam chegando aos campos de texto.
    this.wasd = keyboard.addKeys("W,A,S,D", false) as WasdKeys;
    this.setKeyboardEnabled(this.keyboardWanted);

    const unsubscribe = state.subscribe(() => this.sync());
    // game.destroy() destrói a cena sem passar por SHUTDOWN: escuta os dois.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
    this.events.once(Phaser.Scenes.Events.DESTROY, unsubscribe);
    this.sync();
  }

  /** Liga/desliga as teclas do jogo (desligadas enquanto alguém digita num campo ou com um modal aberto). */
  setKeyboardEnabled(enabled: boolean): void {
    this.keyboardWanted = enabled;
    const keyboard = this.input?.keyboard;
    if (!keyboard) return;
    keyboard.enabled = enabled;
    if (enabled) {
      keyboard.enableGlobalCapture();
    } else {
      keyboard.disableGlobalCapture();
      keyboard.resetKeys();
    }
  }

  update(): void {
    const keysOn = this.input.keyboard?.enabled === true;
    const pressed = (...keys: Phaser.Input.Keyboard.Key[]) => keysOn && keys.some((key) => key.isDown);
    const vx = (pressed(this.cursors.right, this.wasd.D) ? 1 : 0) - (pressed(this.cursors.left, this.wasd.A) ? 1 : 0);
    const vy = (pressed(this.cursors.down, this.wasd.S) ? 1 : 0) - (pressed(this.cursors.up, this.wasd.W) ? 1 : 0);
    const length = Math.hypot(vx, vy) || 1;
    this.player.setVelocity((vx / length) * SPEED, (vy / length) * SPEED);
    if (vx < 0) this.dir = "left";
    else if (vx > 0) this.dir = "right";
    else if (vy < 0) this.dir = "up";
    else if (vy > 0) this.dir = "down";
    this.player.setFlipX(this.dir === "left").setDepth(SPRITE_DEPTH + this.player.y);
    this.nameTag.setPosition(this.player.x, this.player.y - 8);

    const position = { x: Math.round(this.player.x), y: Math.round(this.player.y) };
    this.deps.onMove({ ...position, dir: this.dir, moving: vx !== 0 || vy !== 0 });
    const zone = deskAt(this.deps.map, position)?.id ?? null;
    if (zone !== this.zone) {
      this.zone = zone;
      this.deps.onZone(zone);
    }

    const now = performance.now();
    for (const remote of this.remotes.values()) {
      const at = remote.track.at(now);
      if (!at) continue;
      remote.sprite.setPosition(at.x, at.y).setDepth(SPRITE_DEPTH + at.y);
      remote.name.setPosition(at.x, at.y - 8);
    }
  }

  /** Acompanha o estado: outros jogadores (a Task 9 acrescenta mesas e robôs aqui). */
  private sync(): void {
    this.syncRemotes();
  }

  private syncRemotes(): void {
    const { state } = this.deps;
    const meId = state.me?.id;
    const now = performance.now();
    for (const player of state.players.values()) {
      if (player.id === meId) continue;
      let remote = this.remotes.get(player.id);
      if (!remote) {
        const look = avatarFor(player.id);
        remote = {
          sprite: this.add.sprite(player.x, player.y, TILES_KEY, look.frame).setTint(look.tint),
          name: this.label(player.name),
          track: new Track(),
        };
        this.remotes.set(player.id, remote);
      }
      const last = remote.track.last();
      if (!last || last.x !== player.x || last.y !== player.y) remote.track.push(now, player.x, player.y);
      remote.sprite.setFlipX(player.dir === "left");
    }
    for (const [id, remote] of this.remotes) {
      if (state.players.has(id)) continue;
      remote.sprite.destroy();
      remote.name.destroy();
      this.remotes.delete(id);
    }
  }

  private label(text: string): Phaser.GameObjects.Text {
    return this.add
      .text(0, 0, text, { fontFamily: "monospace", fontSize: "8px", color: "#e6e8ec", resolution: 4 })
      .setOrigin(0.5, 1)
      .setDepth(LABEL_DEPTH);
  }
}
