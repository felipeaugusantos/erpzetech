import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
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
