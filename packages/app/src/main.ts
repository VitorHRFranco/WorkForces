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
import electronUpdater from "electron-updater";
import { channelDir } from "@workforces/bridge/channel";
import { ALIAS_PATTERN, HostSettingsInput, LOCAL_INPUT_MAX, type AppRoute, type FolderChange, type HostConfigResult, type LocalAgentInfo } from "@workforces/protocol";
import { ensureBridgeToken, tokenName } from "./agents/bridge-token.js";
import { FolderStore, INVALID_ALIAS } from "./agents/folders.js";
import { AgentLauncher } from "./agents/launcher.js";
import { LocalAgents } from "./agents/local-agents.js";
import { AgentRecordStore } from "./agents/records.js";
import { countOpenAgents } from "./agents/open-agents.js";
import { findNode, windowsTerminalSpawner } from "./agents/windows-terminal.js";
import { listAddresses } from "./host/addresses.js";
import { Host, PORT_RANGE_ERROR, WAN_ADDRESS_ERROR } from "./host/host.js";
import { EmbeddedServer } from "./host/server-process.js";
import { HostSettingsStore } from "./host/settings.js";
import { upnpPortMapper } from "./host/wan.js";
import { findInviteArg } from "./links.js";
import { cleanupRuntimes, ensureRuntime } from "./runtime/install.js";
import { packagedSource, pageFiles, runtimeRootDir, userDataDir, type Runtime } from "./runtime/layout.js";
import { checkReachable } from "./net/forward.js";
import { SocketRelay } from "./net/office-socket.js";
import { fetchAnchor, officeFetch } from "./net/pinned.js";
import { prepareInvite } from "./offices/join.js";
import { OfficeStore, type SecretBox } from "./offices/store.js";
import { createPageHandler, PAGE_HOST } from "./page/handler.js";
import { AppState } from "./state.js";
import { startUpdates, type Updater } from "./update.js";

const PAGE_PREFIX = `app://${PAGE_HOST}/`;
const MAX_TEXT = 2048;
const MAX_SOCKET_TEXT = 64 * 1024;

const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const isSocketId = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0;
const isAlias = (value: unknown): value is string => isText(value, 32) && ALIAS_PATTERN.test(value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isAgentId = (value: unknown): value is string => isText(value, 36) && UUID.test(value);
const isInput = (value: unknown): value is string => isText(value, LOCAL_INPUT_MAX) && value.length > 0;

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
app.setPath("userData", userDataDir(process.env, app.getPath("appData")));

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
  let host: Host | null = null;
  /** O escritório deste computador já foi desligado na saída: o próximo `before-quit` sai de vez. */
  let hostOff = false;
  /** A saída já pediu o desligar (uma vez só; outro "Sair" no meio só espera o mesmo). */
  let hostStopping = false;
  /** Os agentes que a página está assistindo: ao trocar de escritório, o app para de assistir todos (eles continuam rodando). */
  const watched = new Set<string>();
  const stopWatching = (): void => {
    for (const agentId of watched) localAgents?.unwatch(agentId);
    watched.clear();
  };

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
    const current = state;
    const currentRelay = relay;
    // O convite é preparado (âncora buscada e conferida) antes de largar o escritório aberto.
    void prepareInvite(link).then((prepared) => {
      // Convite que falha não tira ninguém do escritório: o motivo só aparece se nenhum estiver aberto.
      if (!prepared.ok) {
        if (current.current() === null) sendToPage("app:route", { page: "launcher", notice: prepared.notice } satisfies AppRoute);
        return;
      }
      currentRelay.closeAll();
      stopWatching();
      sendToPage("app:route", current.openInvite(prepared.invite, prepared.anchor));
    }, console.warn);
  });

  app.on("before-quit", (event) => {
    quitting = true;
    relay?.closeAll();
    // Só solta os canais: os agentes continuam rodando nas janelas deles, e o app os acha de novo ao reabrir.
    localAgents?.closeAll();
    // O escritório deste computador desliga antes de o app sair (o servidor fecha o banco e solta a porta); depois, sai de
    // vez. Desligado, espera assim mesmo: uma queda logo antes deixa o fechamento da porta no roteador na fila.
    if (host && !hostOff) {
      event.preventDefault();
      if (hostStopping) return;
      hostStopping = true;
      void host
        .turnOff()
        .catch((error: unknown) => console.warn("não consegui desligar o escritório ao sair", error))
        .finally(() => {
          hostOff = true;
          app.quit();
        });
    }
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

  const userData = app.getPath("userData");

  // Instalado: o app usa o próprio Node e uma cópia do servidor e da ponte fora da pasta de instalação (o atualizador troca
  // a instalação, e o Windows não deixa trocar arquivos de um programa rodando). Em desenvolvimento, os do repositório.
  let runtime: Runtime | null = null;
  if (app.isPackaged) {
    app.setAppUserModelId("io.github.vitorhrfranco.workforces");
    const root = runtimeRootDir(process.env, process.platform, userData);
    try {
      const source = packagedSource(process.resourcesPath);
      runtime = await ensureRuntime(source, root, app.getVersion());
      void cleanupRuntimes(root, [`node-${source.nodeVersion}`, `app-${app.getVersion()}`]).catch((error: unknown) => console.warn("não consegui limpar o runtime antigo", error));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox("WorkForces", `não consegui preparar os arquivos do WorkForces em ${root} (${reason}). Libere espaço no disco e abra o app de novo.`);
      app.exit(1);
      return;
    }
  }
  const nodePath = (): Promise<string | null> => (runtime ? Promise.resolve(runtime.node) : findNode());

  // O escritório deste computador: liga só quando a pessoa pede (abrir o app não liga).
  const officeHost = new Host({
    settings: HostSettingsStore.load(join(userData, "host.json"), console.warn),
    server: new EmbeddedServer({ log: console.log }),
    portMapper: upnpPortMapper({ log: console.warn }),
    findNode: nodePath,
    addresses: () => listAddresses(),
    confirmLocal: async (url, pin) => (await fetchAnchor(url, pin)).ok,
    entry: runtime?.serverEntry ?? fileURLToPath(new URL("../../server/dist/embedded.js", import.meta.url)),
    mapFile: runtime?.mapFile ?? null,
    dataDir: join(userData, "office"),
    emit: (status) => sendToPage("host:status", status),
    log: console.warn,
  });
  host = officeHost;

  const appState = new AppState(OfficeStore.load(join(userData, "offices.json"), box, console.warn), () => officeHost.hostedPin());
  state = appState;

  const { clientDir, preload } = pageFiles(app.isPackaged, import.meta.url);

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
  // Os agentes que este app abriu: "Meus agentes" só conecta aos canais registrados aqui.
  const records = new AgentRecordStore(join(app.getPath("userData"), "local-agents.json"), console.warn);
  const agents = new LocalAgents({ dir: channelDir(), records, emit: (event) => sendToPage("agents:event", event), log: console.warn });
  localAgents = agents;
  void agents.scan();

  // O invólucro roda no Node do app (instalado) ou do sistema (desenvolvimento); o caminho do cli.js identifica os agentes abertos.
  const cliPath = runtime?.bridgeCli ?? fileURLToPath(new URL("../../bridge/dist/cli.js", import.meta.url));
  const launcher = new AgentLauncher({
    platform: process.platform,
    folders,
    isDirectory,
    // Instalado, conta pela pasta do runtime: acha agentes de qualquer versão do app (o filtro `claude` deixa o servidor de fora).
    countOpenAgents: () => countOpenAgents(runtime?.root ?? cliPath),
    findNode: nodePath,
    // O escritório é a foto tirada no pedido (agents:spawn): o token e o endereço do start saem do mesmo, mesmo que o aberto mude.
    async ensureToken(office) {
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
        .then((done) => {
          // Sem a janela no prazo (ou com erro, já registrado): o roteiro manual separa isso do sucesso.
          if (!done) console.warn("não consegui minimizar a janela do agente", title);
        })
        .catch((error: unknown) => console.warn("não consegui minimizar a janela do agente", error));
    },
    // O agente não respondeu (no-answer): o motivo está escrito na janela dele, que volta à tela.
    async onNoAnswer(title) {
      if (process.platform !== "win32") return;
      await import("./win/minimize.js")
        .then(({ restoreWindow }) => restoreWindow(title))
        .then((done) => {
          if (!done) console.warn("não consegui restaurar a janela do agente", title);
        })
        .catch((error: unknown) => console.warn("não consegui restaurar a janela do agente", error));
    },
    deliver: (channelId, start, owner) => agents.deliver(channelId, start, owner),
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
  // Mudar o escritório aberto derruba o socket do anterior e para de assistir os agentes dele.
  const switching = (arg: unknown, action: (value: string) => AppRoute): AppRoute => {
    const value = text(arg);
    socketRelay.closeAll();
    stopWatching();
    return action(value);
  };

  /** Prepara o convite (busca e confere a âncora) e abre; se falhar, o aviso vai para a tela inicial. */
  const openInviteLink = async (link: string): Promise<AppRoute> => {
    const prepared = await prepareInvite(link);
    return prepared.ok ? appState.openInvite(prepared.invite, prepared.anchor) : { page: "launcher", notice: prepared.notice };
  };

  handle("app:startup", async () => {
    socketRelay.closeAll();
    stopWatching();
    const link = initialLink;
    initialLink = null;
    return link === null ? appState.startup() : openInviteLink(link);
  });
  handle("offices:list", () => appState.list());
  handle("offices:current", () => appState.current());
  handle("offices:reachable", async (id) => {
    const wanted = text(id);
    const entry = appState.list().find((office) => office.id === wanted);
    const reach = entry ? appState.reachTarget(wanted) : null;
    return reach ? checkReachable(reach.url, officeFetch(reach.anchor)) : false;
  });
  handle("offices:open", (id) => switching(id, (value) => appState.open(value)));
  handle("offices:add", (address) => switching(address, (value) => appState.add(value)));
  handle("offices:forget", (id) => {
    const wanted = text(id);
    socketRelay.closeAll();
    stopWatching();
    appState.forget(wanted);
  });
  handle("offices:changeAddress", (id, address) => {
    const wantedId = text(id);
    const wantedAddress = text(address);
    socketRelay.closeAll();
    stopWatching();
    return appState.changeAddress(wantedId, wantedAddress);
  });
  handle("invites:open", (link) => {
    const value = text(link);
    socketRelay.closeAll();
    stopWatching();
    return openInviteLink(value);
  });

  // O escritório deste computador: a página escolhe, liga, entra e desliga. O status não leva o pino nem o convite de
  // admin; o código do convite só vai à tela de criar a conta, como o de qualquer convite.
  handle("host:status", () => officeHost.status());
  handle("host:configure", async (input): Promise<HostConfigResult> => {
    const parsed = HostSettingsInput.safeParse(input);
    if (!parsed.success) {
      // A porta e o endereço da internet vêm de campos que a pessoa digita; o resto, só a própria página monta.
      if (parsed.error.issues.some((issue) => issue.path[0] === "port")) return { ok: false, error: PORT_RANGE_ERROR };
      if (parsed.error.issues.some((issue) => issue.path[0] === "wanAddress")) return { ok: false, error: WAN_ADDRESS_ERROR };
      throw new Error("argumento inválido");
    }
    // Saindo, o escritório está desligando: nada aqui pode religá-lo depois do desligar da saída.
    if (quitting) return { ok: false, error: "o WorkForces está fechando; abra de novo para mudar o escritório" };
    const before = officeHost.localUrl();
    const result = await officeHost.configure(parsed.data);
    const after = officeHost.localUrl();
    const hosted = appState.findHosted();
    // A entrada do anfitrião aponta para 127.0.0.1 na porta: porta nova, endereço novo, mantendo conta e pino.
    if (result.ok && hosted !== null && after !== null && after !== before) {
      socketRelay.closeAll();
      stopWatching();
      const change = appState.changeAddress(hosted, after);
      if (!change.ok) console.warn("não consegui trocar o endereço do escritório deste computador", change.error);
    }
    return result;
  });
  handle("host:enter", async (): Promise<AppRoute> => {
    // Um "Ligar e entrar" no meio da saída religaria o servidor depois do desligar, e o app sairia com ele no ar.
    if (quitting) return { page: "launcher" };
    socketRelay.closeAll();
    stopWatching();
    const on = await officeHost.turnOn();
    if (!on.ok) return { page: "launcher", notice: on.error };
    const localUrl = officeHost.localUrl()!; // ligado, o escritório existe
    const hosted = appState.findHosted();
    if (hosted !== null) return appState.open(hosted);
    // Sem conta ainda: o convite de admin abre a criação da primeira; com conta e sem entrada salva, o login.
    if (on.adminInvite !== null) return appState.openInvite({ server: localUrl, code: on.adminInvite, pin: on.pin }, on.anchor);
    return appState.openPending(localUrl, on.pin, on.anchor);
  });
  handle("host:stop", async () => {
    await officeHost.turnOff();
    const localUrl = officeHost.localUrl();
    // O escritório aberto era o deste computador (salvo ou ainda no convite/login): ele saiu do ar.
    if (localUrl !== null && appState.current()?.url === localUrl) {
      socketRelay.closeAll();
      stopWatching();
      appState.close();
      sendToPage("app:route", { page: "launcher" } satisfies AppRoute);
    }
    return officeHost.status();
  });

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

  // Agentes: só os que este app abriu para a conta aberta (escritório salvo e nome), que ele já achou pelo canal local.
  const myAgents = (): LocalAgentInfo[] => {
    const office = appState.agentOffice();
    return office === null ? [] : agents.list(office.url, office.userName);
  };
  const knownAgent = (agentId: unknown): agentId is string => isAgentId(agentId) && myAgents().some((agent) => agent.agentId === agentId);
  handle("agents:spawn", (alias) => {
    if (!isAlias(alias)) throw new Error("argumento inválido");
    return launcher.spawn(alias, appState.agentOffice());
  });
  handle("agents:list", async () => {
    await agents.scan();
    return myAgents();
  });
  on("agents:watch", (agentId) => {
    if (!knownAgent(agentId)) return;
    agents.watch(agentId);
    watched.add(agentId);
  });
  // Parar de assistir não faz mal: vale para qualquer agente, também de outro escritório.
  on("agents:unwatch", (agentId) => {
    if (!isAgentId(agentId)) return;
    agents.unwatch(agentId);
    watched.delete(agentId);
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

  // Atualização automática: só instalado (o `autoUpdater` só é tocado aqui, então em desenvolvimento e no E2E nem nasce).
  const updatesEnabled = app.isPackaged && !process.env.WF_NO_UPDATE;
  const inert: Updater = { autoDownload: false, autoInstallOnAppQuit: false, checkForUpdates: () => Promise.resolve(null), quitAndInstall: () => {}, on: () => undefined };
  const updater: Updater = updatesEnabled ? electronUpdater.autoUpdater : inert;
  const updates = startUpdates({
    updater,
    enabled: updatesEnabled,
    notify: (version) => sendToPage("app:update", version),
    log: console.warn,
  });
  app.on("will-quit", updates.stop);
  handle("app:updateCurrent", () => updates.downloaded());
  handle("app:restartToUpdate", async () => {
    if (updates.downloaded() === null || quitting) return;
    quitting = true;
    // O escritório deste computador desliga antes, como na saída; `hostOff` evita que o `before-quit` espere de novo.
    if (host && !hostOff && !hostStopping) {
      hostStopping = true;
      await host.turnOff().catch((error: unknown) => console.warn("não consegui desligar o escritório ao atualizar", error));
    }
    hostOff = true;
    updater.quitAndInstall(true, true);
  });

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
