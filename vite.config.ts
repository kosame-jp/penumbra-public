import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

const devHost = process.env.PENUMBRA_DEV_HOST ?? "127.0.0.1";
const devPort = Number(process.env.PENUMBRA_DEV_PORT ?? 5173);
const useDevHttps = process.env.PENUMBRA_DEV_HTTPS === "1";
const devHttpsKeyPath = path.resolve(process.env.PENUMBRA_DEV_HTTPS_KEY ?? ".cert/penumbra-dev.key");
const devHttpsCertPath = path.resolve(process.env.PENUMBRA_DEV_HTTPS_CERT ?? ".cert/penumbra-dev.crt");
const penumbraCanonicalTimePath = "/__penumbra-time";

export default defineConfig({
  plugins: [penumbraCanonicalTimePlugin()],
  server: {
    host: devHost,
    port: devPort,
    https: useDevHttps
      ? {
          key: fs.readFileSync(devHttpsKeyPath),
          cert: fs.readFileSync(devHttpsCertPath),
        }
      : undefined,
  },
});

function penumbraCanonicalTimePlugin(): Plugin {
  return {
    name: "penumbra-canonical-time",
    configurePreviewServer(server) {
      server.middlewares.use(servePenumbraCanonicalTime);
    },
    configureServer(server) {
      server.middlewares.use(servePenumbraCanonicalTime);
    },
  };
}

function servePenumbraCanonicalTime(
  request: { readonly url?: string },
  response: {
    statusCode: number;
    setHeader(name: string, value: string): void;
    end(body: string): void;
  },
  next: () => void,
): void {
  const requestPath = request.url?.split("?")[0];
  if (requestPath !== penumbraCanonicalTimePath) {
    next();
    return;
  }

  const serverUtcMs = Date.now();
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Date", new Date(serverUtcMs).toUTCString());
  response.end(JSON.stringify({
    serverUtcIso: new Date(serverUtcMs).toISOString(),
    serverUtcMs,
  }));
}
