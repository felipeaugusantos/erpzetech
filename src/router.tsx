import { QueryClient, onlineManager } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // Abriu já sem internet: as consultas esperam a conexão e mostram a cópia guardada, em vez de
  // tentar buscar, falhar e apagar os dados da tela.
  if (typeof window !== "undefined") onlineManager.setOnline(navigator.onLine);
  // Os dados ficam 24 h na memória (e salvos no computador), para as telas abrirem sem internet.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: 1000 * 60 * 60 * 24 } },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
