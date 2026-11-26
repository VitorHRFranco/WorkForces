import { useEffect, useState } from "preact/hooks";
import { bridge } from "../bridge";

/**
 * Avisa que há versão nova baixada; ela entra quando o app reinicia. Com o escritório deste computador ligado, diz que ele
 * desliga e volta sozinho. Se o reinício não sai, diz o que fazer.
 */
export function UpdateNotice() {
  const [version, setVersion] = useState<string | null>(null);
  const [hostOn, setHostOn] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    bridge.update.current().then(
      (current) => {
        if (alive && current !== null) setVersion(current);
      },
      () => {},
    );
    bridge.host.status().then(
      (status) => {
        if (alive) setHostOn(status.state === "on");
      },
      () => {},
    );
    const offReady = bridge.update.onReady((ready) => setVersion(ready));
    const offFailed = bridge.update.onFailed(() => setFailed(true));
    const offHost = bridge.host.onStatus((status) => setHostOn(status.state === "on"));
    return () => {
      alive = false;
      offReady();
      offFailed();
      offHost();
    };
  }, []);

  if (version === null) return null;
  if (failed) {
    return (
      <p class="update-notice" role="alert">
        Não consegui reiniciar para atualizar. Feche o WorkForces pela bandeja e abra de novo.
      </p>
    );
  }
  return (
    <p class="update-notice" role="status">
      versão {version} baixada: ela entra quando o app reiniciar
      {hostOn ? ". O seu escritório desliga por alguns segundos e volta sozinho." : ""}{" "}
      <button type="button" onClick={() => void bridge.update.restart().catch(() => {})}>
        Reiniciar agora
      </button>
    </p>
  );
}
