import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import type { AppRoute } from "@workforces/protocol";
import { render } from "preact";
import { App } from "./app";
import { bridge, hasBridge } from "./bridge";
import { setFlash } from "./flash";
import { bumpGeneration } from "./generation";
import { navigate, routePath } from "./router";

const root = document.getElementById("app")!;

function go(route: AppRoute): void {
  if (route.page === "launcher" && route.notice) setFlash(route.notice);
  navigate(routePath(route), { replace: true });
  bumpGeneration();
}

/** O texto do erro com a pilha, quando há; nunca lança. */
function describeError(value: unknown): string {
  try {
    if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
    return String(value);
  } catch {
    return "erro sem descrição";
  }
}

/** Os erros sem tratamento da página vão para o log do app. */
function reportErrors(): void {
  window.addEventListener("error", (event) => {
    const detail = event.error != null ? describeError(event.error) : `${event.message} (${event.filename}:${event.lineno}:${event.colno})`;
    bridge.log.error(`erro na página: ${detail}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    bridge.log.error(`promessa rejeitada sem tratamento na página: ${describeError(event.reason)}`);
  });
}

if (!hasBridge()) {
  render(
    <main class="card">
      <p>Abra o escritório pelo app WorkForces.</p>
    </main>,
    root,
  );
} else {
  reportErrors();
  bridge.onRoute(go);
  bridge
    .startup()
    .catch((): AppRoute => ({ page: "launcher", notice: "não consegui ler os escritórios salvos" }))
    .then((route) => {
      go(route);
      render(<App />, root);
    });
}
