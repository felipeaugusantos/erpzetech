/** Linha do painel de vacinas: a última dose de cada vacina por pet (devolvida pelo banco). */
export type LinhaPainelVacina = {
  pet_id: string;
  pet: string;
  especie: string | null;
  cliente_id: string;
  tutor: string;
  telefone: string | null;
  vacina: string;
  tipo: string | null;
  aplicada_em: string;
  proxima_dose_em: string;
  dias: number;
};

export type FiltroPainel = "atrasadas" | "proximas" | "todas";

/** Atrasada: a data da próxima dose já passou (dias < 0). Hoje e futuras são próximos reforços. */
export function filtrarPainel(linhas: LinhaPainelVacina[], filtro: FiltroPainel, busca = "") {
  const termo = busca.trim().toLowerCase();
  return linhas.filter((l) => {
    if (filtro === "atrasadas" && l.dias >= 0) return false;
    if (filtro === "proximas" && l.dias < 0) return false;
    if (!termo) return true;
    return [l.pet, l.tutor, l.vacina].some((t) => t.toLowerCase().includes(termo));
  });
}

export function resumoPainel(linhas: LinhaPainelVacina[]) {
  const atrasadas = linhas.filter((l) => l.dias < 0).length;
  return {
    atrasadas,
    proximas: linhas.length - atrasadas,
    pets: new Set(linhas.map((l) => l.pet_id)).size,
  };
}
