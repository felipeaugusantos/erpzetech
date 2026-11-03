import { useQuery } from "@tanstack/react-query";

import { hsDb, linhas } from "@/lib/hotelaria-api";
import type { HsCaixa } from "@/lib/hotelaria-tipos";

/** Caixas abertos do hotel (o pagamento da conta entra no caixa aberto do mesmo hotel). */
export function useCaixasHotel(hotelId: string, ativo = true) {
  return useQuery({
    queryKey: ["hotel-caixas", hotelId],
    enabled: ativo,
    queryFn: async () =>
      linhas<HsCaixa>(
        await hsDb
          .from("caixas")
          .select("id, filial_id, situacao")
          .eq("filial_id", hotelId)
          .eq("situacao", "aberto"),
      ),
  });
}
