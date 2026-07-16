import { defineConfig, loadEnv } from "vite";

// In produzione le route /api/* sono serverless functions Vercel (cartella api/).
// Il dev server Vite non le eseguirebbe: questo plugin le monta in locale
// riusando gli stessi handler, cosi' `npm run dev` funziona contro la sorgente
// dati reale (DATA_SOURCE in .env.local) senza bisogno di `vercel dev`.
function orderwatchApiDevPlugin() {
  const routes = {
    "/session": () => import("./api/session.js"),
    "/dashboard": () => import("./api/dashboard.js"),
    "/settings": () => import("./server/admin/settings.js"),
    "/app-users": () => import("./server/admin/app-users.js"),
    "/mailboxes": () => import("./server/routes/mailboxes.js"),
    "/orders": () => import("./server/routes/orders.js"),
    "/projects": () => import("./server/routes/projects.js"),
    "/suppliers": () => import("./server/routes/suppliers.js"),
    "/contacts": () => import("./server/routes/contacts.js"),
    "/supplier-orders": () => import("./server/routes/supplier-orders.js"),
    "/report-recipients": () => import("./server/admin/report-recipients.js"),
    "/operational-actions": () => import("./server/routes/operational-actions.js"),
    "/customer-confirmations": () => import("./server/routes/customer-confirmations.js"),
    "/receiving": () => import("./server/routes/receiving.js")
  };

  return {
    name: "orderwatch-api-dev",
    configureServer(server) {
      server.middlewares.use("/api", async (req, res, next) => {
        const path = (req.url || "").split("?")[0];
        const loadRoute = routes[path];
        if (!loadRoute) return next();

        try {
          const { default: handler } = await loadRoute();
          const query = Object.fromEntries(new URL(req.url, "http://localhost").searchParams);
          const request = { method: req.method, headers: req.headers, query, body: await readJsonBody(req) };
          const response = {
            statusCode: 200,
            setHeader: (name, value) => res.setHeader(name, value),
            status(code) {
              this.statusCode = code;
              return this;
            },
            json(payload) {
              res.statusCode = this.statusCode;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(payload));
            }
          };
          await handler(request, response);
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Dev API error", detail: error.message }));
        }
      });
    }
  };
}

function readJsonBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(undefined);
      }
    });
    req.on("error", () => resolve(undefined));
  });
}

export default defineConfig(({ mode }) => {
  // Rende disponibili agli handler /api anche le variabili server-side
  // (DATA_SOURCE, SUPABASE_*, AIRTABLE_*) definite in .env.local.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));

  return {
    plugins: [orderwatchApiDevPlugin()],
    esbuild: {
      jsx: "automatic"
    },
    build: {
      reportCompressedSize: false,
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ["react", "react-dom"]
          }
        }
      }
    }
  };
});
