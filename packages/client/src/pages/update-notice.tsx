import { useEffect, useState } from "preact/hooks";
import { bridge } from "../bridge";

/** Avisa que há versão nova baixada; ela entra quando o app reinicia. */
export function UpdateNotice() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    bridge.update.current().then(
      (current) => {
        if (alive && current !== null) setVersion(current);
      },
      () => {},
    );
    const off = bridge.update.onReady((ready) => setVersion(ready));
    return () => {
      alive = false;
      off();
    };
  }, []);

  if (version === null) return null;
  return (
    <p class="update-notice" role="status">
      versão {version} baixada: ela entra quando o app reiniciar{" "}
      <button type="button" onClick={() => void bridge.update.restart().catch(() => {})}>
        Reiniciar agora
      </button>
    </p>
  );
}
