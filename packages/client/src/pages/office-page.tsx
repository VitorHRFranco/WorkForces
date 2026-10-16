import type { Me } from "@workforces/protocol";
import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { navigate } from "../router";

export function OfficePage() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    api.me().then(setMe, () => navigate("/login"));
  }, []);

  const logout = async () => {
    await api.logout().catch(() => undefined);
    navigate("/login");
  };

  if (!me) return <p class="loading">Carregando…</p>;
  return (
    <div class="office">
      <header class="topbar">
        <strong>WorkForces</strong>
        <span class="who">{me.name}</span>
        <span class="spacer" />
        <button type="button" onClick={logout}>
          Sair
        </button>
      </header>
    </div>
  );
}
