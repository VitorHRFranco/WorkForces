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

if (!hasBridge()) {
  render(
    <main class="card">
      <p>Abra o escritório pelo app WorkForces.</p>
    </main>,
    root,
  );
} else {
  bridge.onRoute(go);
  bridge
    .startup()
    .catch((): AppRoute => ({ page: "launcher", notice: "não consegui ler os escritórios salvos" }))
    .then((route) => {
      go(route);
      render(<App />, root);
    });
}
