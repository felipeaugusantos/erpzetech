import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import {
  atualizarBaseRestauranteOffline,
  sincronizarComandasOffline,
} from "@/lib/offline-restaurante";

/** Telas que precisam abrir sem internet: o sistema baixa os arquivos delas com antecedência. */
const TELAS_OFFLINE = ["/frente-caixa", "/salao", "/delivery", "/conferencia-offline", "/lotes-offline"] as const;

/**
 * Roda em todas as telas: envia as comandas guardadas quando a internet volta,
 * mantém a cópia de mesas/cardápio/caixas e deixa as telas de trabalho prontas para abrir sem conexão.
 */
export function useSincronizacaoOffline() {
  const qc = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    let rodando = false;
    async function rodar() {
      if (rodando || !navigator.onLine) return;
      rodando = true;
      try {
        const r = await sincronizarComandasOffline();
        if (r.enviadas) {
          toast.success(`${r.enviadas} comanda(s) feitas sem internet enviadas ao sistema`);
          void qc.invalidateQueries();
        }
        if (r.recusadas)
          toast.error(
            `${r.recusadas} comanda(s) guardada(s) foram recusadas. Veja no Salão ou Delivery.`,
          );
        await atualizarBaseRestauranteOffline();
      } finally {
        rodando = false;
      }
    }

    const preparar = () => {
      if (!navigator.onLine) return;
      for (const to of TELAS_OFFLINE) void router.preloadRoute({ to }).catch(() => undefined);
      // guarda também a página de cada tela no aparelho (service worker)
      for (const to of TELAS_OFFLINE)
        void fetch(to, { credentials: "same-origin" }).catch(() => undefined);
    };

    const aoVoltar = () => void rodar();
    window.addEventListener("online", aoVoltar);
    const t = window.setInterval(() => void rodar(), 30_000);
    const p = window.setTimeout(preparar, 4000);
    void rodar();
    return () => {
      window.removeEventListener("online", aoVoltar);
      window.clearInterval(t);
      window.clearTimeout(p);
    };
  }, [qc, router]);
}
