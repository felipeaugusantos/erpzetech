import type { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { consultaPersistivel } from "@/lib/cache-clinico";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Depois de publicar, uma aba aberta ainda pede arquivos da versão anterior, que já não existem. */
function ehVersaoAntiga(error: unknown) {
  const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /dynamically imported module|Importing a module script failed|error loading dynamically|ChunkLoadError|Failed to fetch dynamically/i.test(
    msg,
  );
}

/** Recarrega a página uma vez (no máximo a cada 30 s) para buscar a versão nova. */
function recarregarVersaoNova() {
  if (typeof window === "undefined") return false;
  const ultima = Number(sessionStorage.getItem("zt-recarga-versao") ?? 0);
  if (Date.now() - ultima < 30_000) return false;
  sessionStorage.setItem("zt-recarga-versao", String(Date.now()));
  window.location.reload();
  return true;
}

if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (e) => {
    if (recarregarVersaoNova()) e.preventDefault();
  });
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    if (ehVersaoAntiga(error) && recarregarVersaoNova()) return;
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Esta tela não abriu
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Algo deu errado. Tente de novo ou volte para o início.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Tentar de novo
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Voltar ao início
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "EZRA ERP — ERP para lojas de material de construção" },
      {
        name: "description",
        content:
          "Sistema de gestão para lojas de materiais de construção: clientes, obras, produtos, estoque em múltiplos depósitos e conversão de unidades.",
      },
      { property: "og:title", content: "EZRA ERP" },
      {
        property: "og:description",
        content: "ERP multiempresa para lojas de materiais de construção.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#008037" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "EZRA ERP" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=Manrope:wght@400;500;600;700&display=swap",
      },
      { rel: "icon", href: "/favicon.png?v=3", type: "image/png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icon-192.png?v=3" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [router, queryClient]);

  // Permite instalar o sistema no celular (atalho em tela cheia abrindo o PDV).
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const id = window.setTimeout(() => {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 24,
        // zt-3: descarta o cache antigo, que ainda podia guardar dado clínico em texto simples
        buster: "zt-3",
        dehydrateOptions: {
          shouldDehydrateQuery: (q) =>
            q.state.status === "success" && consultaPersistivel(q.queryKey),
        },
      }}
    >
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster position="top-right" richColors />
    </PersistQueryClientProvider>
  );
}

// Guarda no computador os dados já carregados, para as telas abrirem sem internet.
const persister = createSyncStoragePersister({
  storage: typeof window === "undefined" ? undefined : window.localStorage,
  key: "zt-dados",
  throttleTime: 2000,
  // algumas telas guardam listas como Map/Set; o JSON comum as transforma em {} e a tela quebra ao reabrir
  serialize: (dados) =>
    JSON.stringify(dados, (_k, v: unknown) =>
      v instanceof Map
        ? { __zt_map: [...v.entries()] }
        : v instanceof Set
          ? { __zt_set: [...v] }
          : v,
    ),
  deserialize: (texto) =>
    JSON.parse(texto, (_k, v: unknown) => {
      if (v && typeof v === "object") {
        const o = v as { __zt_map?: [unknown, unknown][]; __zt_set?: unknown[] };
        if (Array.isArray(o.__zt_map)) return new Map(o.__zt_map);
        if (Array.isArray(o.__zt_set)) return new Set(o.__zt_set);
      }
      return v;
    }),
});
