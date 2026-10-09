import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Chama `aoMudar` quando qualquer linha das tabelas muda (Realtime do Supabase). */
export function useRealtimeTabelas(tabelas: string[], aoMudar: () => void) {
  const callback = useRef(aoMudar);
  useEffect(() => {
    callback.current = aoMudar;
  }, [aoMudar]);

  const chave = tabelas.join(",");
  useEffect(() => {
    const canal = supabase.channel(`rt-${chave}-${Math.random().toString(36).slice(2, 8)}`);
    for (const tabela of chave.split(",")) {
      canal.on("postgres_changes", { event: "*", schema: "public", table: tabela }, () =>
        callback.current(),
      );
    }
    canal.subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [chave]);
}
