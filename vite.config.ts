import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  worker: { format: "es" },
  // Nur für `npm run dev`: WikiTree erlaubt keine Browser-Abrufe (kein CORS, D25). Der Dev-Server reicht
  // Anfragen an /wikitree/api.php an api.wikitree.com durch (ohne Cookies und Browserkennung). Im gebauten Stand gibt es das nicht.
  server: {
    proxy: {
      "/wikitree": {
        target: "https://api.wikitree.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/wikitree/, ""),
        // Nur die Abfrage durchreichen: keine Cookies, keine Browserkennung, keine Herkunft des Nutzers.
        // (WikiTree sperrt Anfragen mit Browser-Kopfzeilen, die über einen Durchleiter kommen.)
        configure: (proxy) => {
          proxy.on("proxyReq", (req) => {
            for (const h of Object.keys(req.getHeaders())) {
              if (!["host", "accept", "connection"].includes(h.toLowerCase())) req.removeHeader(h);
            }
            req.setHeader("User-Agent", "FamilyTree-local/0.1 (private family-tree app)");
          });
        },
      },
    },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
