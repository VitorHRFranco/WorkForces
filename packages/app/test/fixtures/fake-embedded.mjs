// Dublê do servidor embutido: o comportamento vem de FAKE_MODE.
const mode = process.env.FAKE_MODE;
const ready = { type: "ready", pin: "p".repeat(43), anchor: "ANCHOR", adminInvite: null };
process.on("message", (message) => {
  if (message?.type === "stop" && mode !== "stubborn") process.exit(0);
});
if (mode === "output") {
  console.log("linha-stdout");
  console.error("linha-stderr");
  process.send(ready);
} else if (mode === "ready" || mode === "stubborn") {
  process.send(ready);
} else if (mode === "port") {
  process.send({ type: "failed", reason: "port-in-use", message: "porta em uso" }, () => process.exit(0));
} else if (mode === "crash") {
  process.send(ready);
  setTimeout(() => process.exit(3), 200);
}
// silent: não manda nada e fica vivo
setInterval(() => {}, 1000);
