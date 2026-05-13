import "./style.css";
import { bootstrap } from "./app/bootstrap";

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("PENUMBRA mount point #app was not found.");
}

void bootstrap(root);
