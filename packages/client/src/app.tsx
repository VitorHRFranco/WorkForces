import { InvitePage } from "./pages/invite-page";
import { LoginPage } from "./pages/login-page";
import { OfficePage } from "./pages/office-page";
import { usePath } from "./router";

export function App() {
  const path = usePath();
  if (path === "/login") return <LoginPage />;
  const invite = /^\/invite\/([^/]+)$/.exec(path);
  if (invite) return <InvitePage code={decodeURIComponent(invite[1]!)} />;
  return <OfficePage />;
}
