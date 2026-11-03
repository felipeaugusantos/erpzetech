import { useQuery } from "@tanstack/react-query";

import { hsDb, linhas } from "@/lib/hotelaria-api";
import type { HsHospede } from "@/lib/hotelaria-tipos";

/** Hóspedes ativos para escolher na reserva e no check-in (os 1.000 mais recentes por nome). */
export function useHospedes() {
  return useQuery({
    queryKey: ["hotel-hospedes"],
    queryFn: async () =>
      linhas<HsHospede>(
        await hsDb.from("hs_hospedes").select("*").eq("ativo", true).order("nome").limit(1000),
      ),
  });
}

export function filtrarHospedes<
  T extends { nome: string; documento_numero?: string | null; telefone?: string | null },
>(lista: readonly T[], busca: string) {
  const t = busca.trim().toLowerCase();
  if (!t) return lista;
  const digitos = t.replace(/\D/g, "");
  return lista.filter(
    (h) =>
      h.nome.toLowerCase().includes(t) ||
      (digitos.length >= 3 &&
        ((h.documento_numero ?? "").includes(digitos) ||
          (h.telefone ?? "").replace(/\D/g, "").includes(digitos))),
  );
}
