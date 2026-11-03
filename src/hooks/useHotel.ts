import { useCallback, useMemo, useSyncExternalStore } from "react";

import { useSessionData } from "@/hooks/useSessionData";
import type { Hotel } from "@/lib/hotelaria-tipos";

// Cada hotel é uma filial. A escolha fica guardada no navegador e vale para todas as telas da Hotelaria.
const CHAVE = "ezra-hotel-escolhido";
const EVENTO = "ezra-hotel-mudou";

function ler(): string | null {
  try {
    return window.localStorage.getItem(CHAVE);
  } catch {
    return null;
  }
}

function assinar(avisar: () => void) {
  window.addEventListener(EVENTO, avisar);
  window.addEventListener("storage", avisar);
  return () => {
    window.removeEventListener(EVENTO, avisar);
    window.removeEventListener("storage", avisar);
  };
}

/** Hotel em uso: o escolhido, senão o único (ou o fixo do usuário), senão o primeiro. Quem só acessa uma filial só vê a própria. */
export function useHotel() {
  const { data: sessao, isLoading } = useSessionData();
  const escolhido = useSyncExternalStore(assinar, ler, () => null);

  const hoteis = useMemo<Hotel[]>(() => {
    const todas = sessao?.filiais ?? [];
    const fixa = sessao?.profile?.filial_id;
    return (fixa ? todas.filter((f) => f.id === fixa) : todas).map((f) => ({
      id: f.id,
      nome: f.nome,
    }));
  }, [sessao]);

  const hotel = hoteis.find((h) => h.id === escolhido) ?? hoteis[0] ?? null;

  const escolher = useCallback((id: string) => {
    try {
      window.localStorage.setItem(CHAVE, id);
    } catch {
      /* sem armazenamento: a escolha vale só até recarregar */
    }
    window.dispatchEvent(new Event(EVENTO));
  }, []);

  return { carregando: isLoading, hoteis, hotel, escolher };
}
