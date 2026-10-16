import { InvitePage } from "./pages/invite-page";
import { LoginPage } from "./pages/login-page";
import { OfficePage } from "./pages/office-page";
import { usePath } from "./router";

function decodeCode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function App() {
  const path = usePath();
  if (path === "/login") return <LoginPage />;
  const invite = /^\/invite\/([^/]+)$/.exec(path);
  if (invite) return <InvitePage code={decodeCode(invite[1]!)} />;
  return <OfficePage />;
}
