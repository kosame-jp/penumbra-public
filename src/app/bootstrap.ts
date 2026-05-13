import { parseQueryFlags } from "./query-flags";
import { readBrowserPerformanceHints, resolveAppMode } from "./modes";
import { PenumbraApp } from "./PenumbraApp";

export async function bootstrap(root: HTMLElement): Promise<PenumbraApp> {
  const flags = parseQueryFlags(window.location.search);
  const mode = resolveAppMode(flags, readBrowserPerformanceHints());
  const app = new PenumbraApp(root, mode);
  await app.start();
  return app;
}
