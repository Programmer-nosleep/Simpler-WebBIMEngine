import { defineConfig, type Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_IFC_PUBLIC_PATH = "/wasm/";
const WEB_IFC_FILES = ["web-ifc.wasm", "web-ifc-mt.wasm", "web-ifc-mt.worker.js"] as const;

function webIfcAssets(): Plugin {
  const rootDir = path.dirname(fileURLToPath(import.meta.url));
  const webIfcDir = path.join(rootDir, "node_modules", "web-ifc");
  const allowed = new Set<string>(WEB_IFC_FILES);

  const resolveFile = (fileName: string) => path.join(webIfcDir, fileName);

  return {
    name: "web-ifc-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith(WEB_IFC_PUBLIC_PATH)) return next();

        const fileName = url.slice(WEB_IFC_PUBLIC_PATH.length).split("?")[0]?.split("#")[0] ?? "";
        if (!allowed.has(fileName)) return next();

        const filePath = resolveFile(fileName);
        if (!fs.existsSync(filePath)) {
          res.statusCode = 404;
          res.end();
          return;
        }

        if (fileName.endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");
        else res.setHeader("Content-Type", "text/javascript");

        fs.createReadStream(filePath).pipe(res);
      });
    },
    generateBundle() {
      for (const fileName of WEB_IFC_FILES) {
        const filePath = resolveFile(fileName);
        if (!fs.existsSync(filePath)) continue;

        this.emitFile({
          type: "asset",
          fileName: `wasm/${fileName}`,
          source: fs.readFileSync(filePath),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [webIfcAssets()],
});
