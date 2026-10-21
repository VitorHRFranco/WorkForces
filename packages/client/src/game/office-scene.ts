import { deskAt, type Direction, type OfficeMap, type Point, type Seat } from "@workforces/protocol";
import Phaser from "phaser";
import type { OfficeState } from "../office/office-state";
import { cameraFrame, panelInset } from "./camera";
import { layoutDesks, robotLook } from "./desk-layout";
import type { MoveState } from "./move-sender";
import { FEET, FOOT_Y, PEOPLE_VARIANTS, PERSON_FRAME, animKey, personVariant, poseFrames, poseOf, type PoseKind } from "./people";
import { propDef, propOrigin, solidRect } from "./props";
import { SIT_DELAY_MS, nearestSeat, seatAt, standSpot } from "./seating";
import { Track } from "./track";

const TILES_KEY = "tiles";
const PEOPLE_KEY = "people";
const ROBOT_KEY = "robot";
const PROPS_KEY = "props";
const MAP_KEY = "office";
const ROBOT_WORKING = "robot-working";
/** Imagens de packages/client/public/sprites (geradas por tools/art/build_art.py). */
const SPRITES_URL = "/sprites";
const ROBOT_SIZE = { width: 24, height: 28 };
/** Pixels por segundo. */
const SPEED = 120;
const ZOOM = 2;
/** Sprites ficam acima das camadas do mapa e se sobrepõem pela altura dos pés (y). */
const SPRITE_DEPTH = 100;
const SMALL_TEXT_DEPTH = 9_000;
const LABEL_DEPTH = 10_000;
/** Altura do nome acima dos pés. */
const NAME_ABOVE_FEET = 50;
const DIRECTIONS: Direction[] = ["up", "down", "left", "right"];
const POSES: PoseKind[] = ["walk", "idle", "sit"];
/** Contorno escuro: os textos continuam legíveis sobre o piso e os móveis. */
const OUTLINE = { stroke: "#1d2027", strokeThickness: 2 };

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
  variant: number;
}

type ArrowKeys = Record<"up" | "down" | "left" | "right", Phaser.Input.Keyboard.Key>;
type WasdKeys = Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;

export class OfficeScene extends Phaser.Scene {
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private nameTag!: Phaser.GameObjects.Text;
  private cursors!: ArrowKeys;
  private wasd!: WasdKeys;
  private variant = 0;
  private readonly remotes = new Map<number, Remote>();
  private dir: Direction = "down";
  private zone: string | null = null;
  private keyboardWanted = true;
  private panelOpen = false;
  /** O create já rodou: a câmera e o avatar existem. */
  private ready = false;
  /** Assento em que o avatar está sentado (null em pé). */
  private seat: Seat | null = null;
  /** Onde o avatar estava antes de sentar: ao levantar, volta para lá (o assento pode ficar dentro do móvel, como no sofá). */
  private standAt: Point | null = null;
  /** Desde quando o avatar está parado (relógio da cena, em ms). */
  private stillSince = 0;
  /** Tudo o que foi desenhado para mesas e robôs; refeito quando agentes ou mesas mudam. */
  private deskObjects: Phaser.GameObjects.GameObject[] = [];
  private deskSignature = "";

  constructor(private readonly deps: OfficeSceneDeps) {
    super("office");
  }

  preload(): void {
    const size = this.deps.map.tileSize;
    this.load.spritesheet(TILES_KEY, this.deps.tilesUrl, { frameWidth: size, frameHeight: size });
    this.load.spritesheet(PEOPLE_KEY, `${SPRITES_URL}/people.png`, { frameWidth: PERSON_FRAME, frameHeight: PERSON_FRAME });
    this.load.spritesheet(ROBOT_KEY, `${SPRITES_URL}/robot.png`, { frameWidth: ROBOT_SIZE.width, frameHeight: ROBOT_SIZE.height });
    this.load.image(PROPS_KEY, `${SPRITES_URL}/props.png`);
  }

  create(): void {
    const { map: office, state } = this.deps;
    this.createAnimations();
    const walls = this.createTilemap();
    const solids = this.createProps();

    const me = state.me!;
    const saved = state.players.get(me.id) ?? office.spawn;
    // Quem recarrega a página sentado volta no ponto do assento: começa em pé ao lado e senta de novo sozinho, se o assento estiver livre.
    const savedSeat = seatAt(office.seats, saved);
    const start = savedSeat ? standSpot(savedSeat, office.props.flatMap((prop) => solidRect(prop) ?? [])) : saved;
    this.variant = personVariant(me.id);
    this.player = this.physics.add.sprite(start.x, start.y, PEOPLE_KEY);
    this.player.setDisplayOrigin(PERSON_FRAME / 2, FOOT_Y);
    this.player.body.setSize(FEET.width, FEET.height).setOffset((PERSON_FRAME - FEET.width) / 2, FOOT_Y - FEET.height);
    this.player.setCollideWorldBounds(true);
    this.physics.world.setBounds(0, 0, office.widthPx, office.heightPx);
    for (const layer of walls) this.physics.add.collider(this.player, layer);
    this.physics.add.collider(this.player, solids);
    this.nameTag = this.label(me.name);

    this.cameras.main.setZoom(ZOOM).setRoundPixels(true).startFollow(this.player, true);
    const onResize = () => this.applyCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);

    const keyboard = this.input.keyboard!;
    // Só as setas são capturadas: Espaço e Shift continuam livres para os botões da página.
    const { UP, DOWN, LEFT, RIGHT } = Phaser.Input.Keyboard.KeyCodes;
    this.cursors = keyboard.addKeys({ up: UP, down: DOWN, left: LEFT, right: RIGHT }) as ArrowKeys;
    // false: as letras não são capturadas pelo jogo e continuam chegando aos campos de texto.
    this.wasd = keyboard.addKeys("W,A,S,D", false) as WasdKeys;
    this.setKeyboardEnabled(this.keyboardWanted);

    const unsubscribe = state.subscribe(() => this.sync());
    const cleanup = () => {
      unsubscribe();
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
    };
    // game.destroy() destrói a cena sem passar por SHUTDOWN: escuta os dois.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup);
    this.ready = true;
    this.applyCamera();
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

  /** O painel do terminal cobre a direita do canvas: a câmera leva o avatar para o meio do que sobra. */
  setPanelOpen(open: boolean): void {
    this.panelOpen = open;
    this.applyCamera();
  }

  update(time: number): void {
    const keysOn = this.input.keyboard?.enabled === true;
    const pressed = (...keys: Phaser.Input.Keyboard.Key[]) => keysOn && keys.some((key) => key.isDown);
    const vx = (pressed(this.cursors.right, this.wasd.D) ? 1 : 0) - (pressed(this.cursors.left, this.wasd.A) ? 1 : 0);
    const vy = (pressed(this.cursors.down, this.wasd.S) ? 1 : 0) - (pressed(this.cursors.up, this.wasd.W) ? 1 : 0);
    const moving = vx !== 0 || vy !== 0;
    if (moving) {
      if (this.seat) this.standUp();
      this.stillSince = time;
      if (vx < 0) this.dir = "left";
      else if (vx > 0) this.dir = "right";
      else if (vy < 0) this.dir = "up";
      else this.dir = "down";
    } else if (!this.seat && time - this.stillSince >= SIT_DELAY_MS) {
      this.trySit();
    }
    if (!this.seat) {
      const length = Math.hypot(vx, vy) || 1;
      this.player.setVelocity((vx / length) * SPEED, (vy / length) * SPEED);
    }
    this.player.setDepth(SPRITE_DEPTH + this.player.y).play(animKey(this.variant, poseOf(moving, this.dir, this.seat?.dir ?? null)), true);
    this.nameTag.setPosition(this.player.x, this.player.y - NAME_ABOVE_FEET);

    const position = { x: Math.round(this.player.x), y: Math.round(this.player.y) };
    this.deps.onMove({ ...position, dir: this.dir, moving });
    const zone = deskAt(this.deps.map, position)?.id ?? null;
    if (zone !== this.zone) {
      this.zone = zone;
      this.deps.onZone(zone);
    }

    const { state, map } = this.deps;
    const now = performance.now();
    for (const [id, remote] of this.remotes) {
      const at = remote.track.at(now);
      const player = state.players.get(id);
      if (!at || !player) continue;
      // Parado no ponto exato de um assento = sentado (é para lá que quem senta vai).
      const seat = player.moving ? null : seatAt(map.seats, player);
      remote.sprite
        .setPosition(at.x, at.y)
        .setDepth(SPRITE_DEPTH + at.y)
        .play(animKey(remote.variant, poseOf(player.moving, player.dir, seat?.dir ?? null)), true);
      remote.name.setPosition(at.x, at.y - NAME_ABOVE_FEET);
    }
  }

  /** Parado perto de um assento livre: vai para o ponto do assento e senta. */
  private trySit(): void {
    const { state, map } = this.deps;
    const at = { x: Math.round(this.player.x), y: Math.round(this.player.y) };
    const others = [...state.players.values()].filter((player) => player.id !== state.me?.id);
    const seat = nearestSeat(map.seats, at, others);
    if (!seat) return;
    this.seat = seat;
    this.standAt = at;
    this.dir = seat.dir;
    this.player.setVelocity(0, 0);
    // Sentado, o corpo sai da física: o assento pode ficar dentro do móvel (sofá, poltrona).
    this.player.body.enable = false;
    this.player.setPosition(seat.x, seat.y);
  }

  /** Levanta e volta para onde estava antes de sentar (fora de qualquer móvel). */
  private standUp(): void {
    const back = this.standAt ?? { x: this.player.x, y: this.player.y };
    this.seat = null;
    this.standAt = null;
    this.player.setPosition(back.x, back.y);
    this.player.body.enable = true;
  }

  private applyCamera(): void {
    if (!this.ready) return;
    const { widthPx, heightPx } = this.deps.map;
    const frame = cameraFrame(widthPx, panelInset(this.scale.width, this.panelOpen), ZOOM);
    this.cameras.main.setBounds(0, 0, frame.boundsWidth, heightPx).setFollowOffset(frame.offsetX, 0);
  }

  private createAnimations(): void {
    for (let variant = 0; variant < PEOPLE_VARIANTS; variant++) {
      for (const dir of DIRECTIONS) {
        for (const kind of POSES) {
          const pose = { kind, dir };
          this.anims.create({
            key: animKey(variant, pose),
            frames: this.anims.generateFrameNumbers(PEOPLE_KEY, { frames: poseFrames(variant, pose) }),
            frameRate: kind === "walk" ? 12 : 3,
            repeat: -1,
          });
        }
      }
    }
    this.anims.create({ key: ROBOT_WORKING, frames: this.anims.generateFrameNumbers(ROBOT_KEY, { frames: [0, 1] }), frameRate: 3, repeat: -1 });
  }

  /** Desenha as camadas do Tiled; devolve as que bloqueiam a passagem (propriedade `collides`). */
  private createTilemap(): Phaser.Tilemaps.TilemapLayer[] {
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
    return walls;
  }

  /** Móveis e decoração, ordenados pela base; devolve os blocos invisíveis que barram a passagem. */
  private createProps(): Phaser.GameObjects.Zone[] {
    const texture = this.textures.get(PROPS_KEY);
    const solids: Phaser.GameObjects.Zone[] = [];
    for (const prop of this.deps.map.props) {
      const def = propDef(prop.sprite);
      if (!def) {
        console.warn(`mapa: móvel sem imagem no atlas: ${prop.sprite}`);
        continue;
      }
      if (!texture.has(prop.sprite)) texture.add(prop.sprite, 0, def.x, def.y, def.w, def.h);
      const origin = propOrigin(def);
      this.add.image(prop.x, prop.y, PROPS_KEY, prop.sprite).setDisplayOrigin(origin.x, origin.y).setDepth(SPRITE_DEPTH + prop.y);
      const solid = solidRect(prop);
      if (!solid) continue;
      const zone = this.add.zone(solid.x + solid.width / 2, solid.y + solid.height / 2, solid.width, solid.height);
      this.physics.add.existing(zone, true);
      solids.push(zone);
    }
    return solids;
  }

  /** Acompanha o estado: outros jogadores, mesas e robôs. */
  private sync(): void {
    this.syncRemotes();
    this.syncDesks();
  }

  private syncDesks(): void {
    const { state, map } = this.deps;
    // Só redesenha quando agentes ou mesas mudam (o estado também muda a cada passo dos outros jogadores).
    const signature = JSON.stringify([[...state.desks.values()], [...state.agents.values()]]);
    if (signature === this.deskSignature) return;
    this.deskSignature = signature;
    for (const object of this.deskObjects) object.destroy();
    this.deskObjects = [];

    for (const view of layoutDesks(map, state.desks, state.agents.values())) {
      this.deskObjects.push(this.smallText(view.plate.x, view.plate.y, view.ownerName ?? "livre", view.ownerName ? "#e6e8ec" : "#9aa3b2"));
      for (const { agent, at } of view.robots) {
        const look = robotLook(agent);
        const robot = this.add
          .sprite(at.x, at.y, ROBOT_KEY, 0)
          .setDisplayOrigin(ROBOT_SIZE.width / 2, ROBOT_SIZE.height)
          .setAlpha(look.alpha)
          .setDepth(SPRITE_DEPTH + at.y);
        if (agent.connected && agent.status === "working") robot.play(ROBOT_WORKING);
        const dot = this.add
          .graphics()
          .fillStyle(look.dot, 1)
          .fillCircle(at.x + 11, at.y - ROBOT_SIZE.height + 3, 2.5)
          .setDepth(SMALL_TEXT_DEPTH);
        this.deskObjects.push(robot, dot, this.smallText(at.x, at.y - ROBOT_SIZE.height - 1, agent.label.slice(0, 14), "#e6e8ec"));
        if (look.note) this.deskObjects.push(this.smallText(at.x, at.y + 9, look.note, "#f4b41b"));
      }
      if (view.extra > 0) this.deskObjects.push(this.smallText(view.extraAt.x, view.extraAt.y, `+${view.extra}`, "#f4b41b"));
    }
  }

  private syncRemotes(): void {
    const { state } = this.deps;
    const meId = state.me?.id;
    const now = performance.now();
    for (const player of state.players.values()) {
      if (player.id === meId) continue;
      let remote = this.remotes.get(player.id);
      if (!remote) {
        remote = {
          sprite: this.add.sprite(player.x, player.y, PEOPLE_KEY).setDisplayOrigin(PERSON_FRAME / 2, FOOT_Y),
          name: this.label(player.name),
          track: new Track(),
          variant: personVariant(player.id),
        };
        this.remotes.set(player.id, remote);
      }
      const last = remote.track.last();
      if (!last || last.x !== player.x || last.y !== player.y) remote.track.push(now, player.x, player.y);
    }
    for (const [id, remote] of this.remotes) {
      if (state.players.has(id)) continue;
      remote.sprite.destroy();
      remote.name.destroy();
      this.remotes.delete(id);
    }
  }

  private smallText(x: number, y: number, text: string, color: string): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, text, { fontFamily: "monospace", fontSize: "7px", color, resolution: 4, ...OUTLINE })
      .setOrigin(0.5, 1)
      .setDepth(SMALL_TEXT_DEPTH);
  }

  private label(text: string): Phaser.GameObjects.Text {
    return this.add
      .text(0, 0, text, { fontFamily: "monospace", fontSize: "8px", color: "#ffffff", resolution: 4, ...OUTLINE })
      .setOrigin(0.5, 1)
      .setDepth(LABEL_DEPTH);
  }
}
