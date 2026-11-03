import { statSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import * as tls from "node:tls";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  safeStorage,
  session,
  shell,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { channelDir } from "@workforces/bridge/channel";
import { ALIAS_PATTERN, LOCAL_INPUT_MAX, type AppRoute, type FolderChange } from "@workforces/protocol";
import { ensureBridgeToken, tokenName } from "./agents/bridge-token.js";
import { FolderStore } from "./agents/folders.js";
import { AgentLauncher } from "./agents/launcher.js";
import { LocalAgents } from "./agents/local-agents.js";
import { countOpenAgents } from "./agents/open-agents.js";
import { findNode, windowsTerminalSpawner } from "./agents/windows-terminal.js";
import { findInviteArg, parseInviteLink } from "./links.js";
import { checkReachable } from "./net/forward.js";
import { SocketRelay } from "./net/office-socket.js";
import { OfficeStore, type SecretBox } from "./offices/store.js";
import { createPageHandler, PAGE_HOST } from "./page/handler.js";
import { AppState } from "./state.js";

const PAGE_PREFIX = `app://${PAGE_HOST}/`;
const MAX_TEXT = 2048;
const MAX_SOCKET_TEXT = 64 * 1024;

const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const isSocketId = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0;
const isAlias = (value: unknown): value is string => isText(value, 32) && ALIAS_PATTERN.test(value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isAgentId = (value: unknown): value is string => isText(value, 36) && UUID.test(value);
const isInput = (value: unknown): value is string => isText(value, LOCAL_INPUT_MAX) && value.length > 0;
const INVALID_ALIAS = "apelido inválido: use até 32 letras minúsculas, números e hífen, começando por letra ou número";

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Só a página empacotada fala com o processo principal. */
const fromPage = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => event.senderFrame?.url.startsWith(PAGE_PREFIX) === true;

let tray: Tray | null = null; // no módulo: sem referência o coletor de lixo remove o ícone da bandeja

// Falha ao iniciar não pode deixar um processo sem janela segurando o bloqueio de instância única.
const fail = (error: unknown): void => {
  console.error(error);
  app.exit(1);
};

/**
 * O `fetch` e o `ws` do processo principal passam a confiar também nas CAs instaladas no sistema (no Windows, o
 * repositório de certificados), além das que vêm com o Node: a CA da rede interna instalada na máquina vale para o app.
 */
function trustSystemCertificates(): void {
  if (typeof tls.getCACertificates !== "function" || typeof tls.setDefaultCACertificates !== "function") return;
  try {
    tls.setDefaultCACertificates([...tls.getCACertificates("default"), ...tls.getCACertificates("system")]);
  } catch (error) {
    console.warn("não consegui usar os certificados do sistema; só as CAs do Node valem", error);
  }
}

// A pasta de dados precisa ser trocada antes de qualquer uso (o E2E usa uma por instância).
if (process.env.WF_APP_DATA_DIR) app.setPath("userData", resolve(process.env.WF_APP_DATA_DIR));

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();
else start().catch(fail);

async function start(): Promise<void> {
  let initialLink = findInviteArg(process.argv);
  let quitting = false;
  let window: BrowserWindow | null = null;
  let state: AppState | null = null;
  let relay: SocketRelay | null = null;
  let localAgents: LocalAgents | null = null;

  if (!process.env.WF_APP_NO_PROTOCOL) {
    if (process.defaultApp) app.setAsDefaultProtocolClient("workforces", process.execPath, [resolve(process.argv[1]!)]);
    else app.setAsDefaultProtocolClient("workforces");
  }

  /** Manda para a página, a menos que a janela já tenha sido destruída. */
  const sendToPage = (channel: string, ...args: unknown[]): void => {
    if (window && !window.isDestroyed()) window.webContents.send(channel, ...args);
  };

  const showWindow = (): void => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };

  app.on("second-instance", (_event, argv) => {
    showWindow();
    const link = findInviteArg(argv);
    if (link === null || !state || !relay) return;
    // Link inválido não tira ninguém do escritório: o motivo só aparece se nenhum estiver aberto.
    const parsed = parseInviteLink(link);
    if ("error" in parsed) {
      if (state.current() === null) sendToPage("app:route", { page: "launcher", notice: parsed.error } satisfies AppRoute);
      return;
    }
    relay.closeAll();
    sendToPage("app:route", state.openLink(link));
  });

  app.on("before-quit", () => {
    quitting = true;
    relay?.closeAll();
    // Só solta os canais: os agentes continuam rodando nas janelas deles, e o app os acha de novo ao reabrir.
    localAgents?.closeAll();
  });

  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event) => {
      if (event.url.startsWith(PAGE_PREFIX)) return;
      event.preventDefault();
      if (/^https?:\/\//.test(event.url)) void shell.openExternal(event.url);
    });
  });

  await app.whenReady();
  trustSystemCertificates();
  Menu.setApplicationMenu(null);

  // Só o botão "Copiar" do convite precisa de permissão; o resto é negado.
  const allowed = (permission: string): boolean => permission === "clipboard-sanitized-write";
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(allowed(permission)));
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => allowed(permission));

  // Sem chaveiro no Linux o Chromium cai no texto puro; no Windows vale o DPAPI.
  if (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text") safeStorage.setUsePlainTextEncryption(true);
  const box: SecretBox = {
    available: () => safeStorage.isEncryptionAvailable(),
    seal: (plain) => safeStorage.encryptString(plain).toString("base64"),
    open: (sealed) => safeStorage.decryptString(Buffer.from(sealed, "base64")),
  };

  const appState = new AppState(OfficeStore.load(join(app.getPath("userData"), "offices.json"), box, console.warn));
  state = appState;

  const clientDir = fileURLToPath(new URL("../../client/dist", import.meta.url));
  const preload = fileURLToPath(new URL("./preload.cjs", import.meta.url));

  const socketRelay = new SocketRelay(
    (id, event) => sendToPage("socket:event", id, event),
    () => {
      // Falhar ao gravar o perfil aqui viraria exceção sem dono no processo principal; a sessão já saiu da memória.
      try {
        appState.unauthorized();
      } catch (error) {
        console.warn("não consegui apagar a sessão guardada", error);
      }
    },
  );
  relay = socketRelay;

  protocol.handle(
    "app",
    createPageHandler({
      clientDir,
      target: () => appState.target(),
      onAuth: (change) => appState.applyAuth(change),
      onUnauthorized: () => appState.unauthorized(),
    }),
  );

  // Agentes deste computador: as pastas liberadas, os canais locais e o "Chamar agente".
  const folders = FolderStore.load(join(app.getPath("userData"), "agents.json"), console.warn);
  const agents = new LocalAgents({ dir: channelDir(), emit: (event) => sendToPage("agents:event", event), log: console.warn });
  localAgents = agents;
  void agents.scan();

  // O invólucro roda no Node do sistema; o mesmo caminho do cli.js identifica os agentes abertos na contagem.
  const cliPath = fileURLToPath(new URL("../../bridge/dist/cli.js", import.meta.url));
  const launcher = new AgentLauncher({
    platform: process.platform,
    folders,
    isDirectory,
    countOpenAgents: () => countOpenAgents(cliPath),
    findNode: () => findNode(),
    async ensureToken() {
      // O id vem da foto tirada antes de pedir o token: o escritório aberto pode mudar enquanto ele é criado.
      const office = appState.agentOffice();
      if (office === null) return { ok: false, error: "no-office" };
      const result = await ensureBridgeToken(office, tokenName(hostname()));
      if (result.ok && result.created) {
        try {
          appState.saveBridgeToken(office.id, result.token);
        } catch (error) {
          // O token vale nesta execução; sem gravar, o próximo início cria outro.
          console.warn("não consegui guardar o token da ponte", error);
        }
      }
      return result;
    },
    spawner: windowsTerminalSpawner(cliPath),
    async minimize(title) {
      if (process.platform !== "win32") return;
      await import("./win/minimize.js")
        .then(({ minimizeWindow }) => minimizeWindow(title))
        .catch((error: unknown) => console.warn("não consegui minimizar a janela do agente", error));
    },
    deliver: (channelId, start) => agents.deliver(channelId, start),
    now: () => Date.now(),
    log: console.warn,
  });

  // IPC: cada handler confere o remetente e os argumentos antes de tocar no estado.
  const handle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!fromPage(event)) throw new Error("remetente não autorizado");
      return fn(...args);
    });
  };
  const on = (channel: string, fn: (...args: unknown[]) => void): void => {
    ipcMain.on(channel, (event, ...args) => {
      if (fromPage(event)) fn(...args);
    });
  };
  const text = (value: unknown): string => {
    if (!isText(value, MAX_TEXT)) throw new Error("argumento inválido");
    return value;
  };
  // Mudar o escritório aberto derruba o socket do anterior.
  const switching = (arg: unknown, action: (value: string) => AppRoute): AppRoute => {
    const value = text(arg);
    socketRelay.closeAll();
    return action(value);
  };

  handle("app:startup", () => {
    socketRelay.closeAll();
    const link = initialLink;
    initialLink = null;
    return appState.startup(link);
  });
  handle("offices:list", () => appState.list());
  handle("offices:current", () => appState.current());
  handle("offices:reachable", async (id) => {
    const wanted = text(id);
    const entry = appState.list().find((office) => office.id === wanted);
    return entry ? checkReachable(entry.url) : false;
  });
  handle("offices:open", (id) => switching(id, (value) => appState.open(value)));
  handle("offices:add", (address) => switching(address, (value) => appState.add(value)));
  handle("offices:forget", (id) => {
    const wanted = text(id);
    socketRelay.closeAll();
    appState.forget(wanted);
  });
  handle("invites:open", (link) => switching(link, (value) => appState.openLink(value)));

  on("socket:open", (id) => {
    if (isSocketId(id)) socketRelay.open(id, appState.target());
  });
  on("socket:send", (id, payload) => {
    if (isSocketId(id) && isText(payload, MAX_SOCKET_TEXT)) socketRelay.send(id, payload);
  });
  on("socket:close", (id, code) => {
    if (isSocketId(id) && typeof code === "number" && Number.isInteger(code)) socketRelay.close(id, code);
  });

  // Pastas: a página manda só o apelido; o caminho vem do seletor nativo, aqui no processo principal.
  handle("folders:list", () => folders.list());
  handle("folders:pickAndAdd", async (alias): Promise<FolderChange | null> => {
    if (typeof alias !== "string") throw new Error("argumento inválido");
    // O apelido vem do formulário: a recusa volta como texto para a página mostrar, sem abrir o seletor.
    if (!isAlias(alias)) return { ok: false, error: INVALID_ALIAS };
    const options: Electron.OpenDialogOptions = { title: "Escolha a pasta do projeto", properties: ["openDirectory"] };
    const picked = window && !window.isDestroyed() ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    const path = picked.filePaths[0];
    if (picked.canceled || path === undefined) return null;
    return folders.add(alias, path);
  });
  handle("folders:remove", (alias) => {
    if (!isAlias(alias)) throw new Error("argumento inválido");
    return folders.remove(alias);
  });

  // Agentes: só os deste computador, no escritório aberto, que o app já achou pelo canal local.
  const currentUrl = (): string | null => appState.current()?.url ?? null;
  const knownAgent = (agentId: unknown): agentId is string => {
    if (!isAgentId(agentId)) return false;
    const url = currentUrl();
    return url !== null && agents.list(url).some((agent) => agent.agentId === agentId);
  };
  handle("agents:spawn", (alias) => {
    if (!isAlias(alias)) throw new Error("argumento inválido");
    const office = appState.agentOffice();
    return launcher.spawn(alias, office === null ? null : { url: office.url });
  });
  handle("agents:list", async () => {
    await agents.scan();
    const url = currentUrl();
    return url === null ? [] : agents.list(url);
  });
  on("agents:watch", (agentId) => {
    if (knownAgent(agentId)) agents.watch(agentId);
  });
  on("agents:unwatch", (agentId) => {
    if (knownAgent(agentId)) agents.unwatch(agentId);
  });
  on("agents:input", (agentId, data) => {
    if (knownAgent(agentId) && isInput(data)) agents.input(agentId, data);
  });

  const icon = nativeImage.createFromPath(join(clientDir, "sprites", "robot.png")).crop({ x: 0, y: 0, width: 24, height: 28 });

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: "WorkForces",
    icon,
    autoHideMenuBar: true,
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  window = win;
  win.loadURL(PAGE_PREFIX).catch(fail);
  win.once("ready-to-show", () => win.show());
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });
  if (!app.isPackaged) {
    win.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      if (input.key === "F5") {
        event.preventDefault();
        win.webContents.reload();
      } else if (input.key === "F12") {
        event.preventDefault();
        win.webContents.toggleDevTools();
      }
    });
  }

  tray = new Tray(icon.resize({ height: 16 }));
  tray.setToolTip("WorkForces");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Abrir o WorkForces", click: showWindow },
      { type: "separator" },
      {
        label: "Sair",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", showWindow);
}
