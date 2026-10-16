import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { render } from "preact";
import { App } from "./app";

render(<App />, document.getElementById("app")!);
