import { useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";

/** Verdadeiro com internet. Reage à troca de estado (a mesma fonte que pausa as consultas). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (aviso) => onlineManager.subscribe(aviso),
    () => onlineManager.isOnline(),
    () => true,
  );
}
