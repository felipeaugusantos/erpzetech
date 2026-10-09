import { useEffect, useState } from "react";

/** Instante atual, renovado a cada `intervaloMs`: faz a tela recalcular "há X min" sem esperar um evento. */
export function useRelogio(intervaloMs = 30_000): Date {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), intervaloMs);
    return () => clearInterval(id);
  }, [intervaloMs]);
  return agora;
}
