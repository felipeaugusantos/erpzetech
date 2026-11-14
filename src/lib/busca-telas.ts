export type TelaBusca = { label: string; to: string; grupo: string };

/** Remove acentos e caixa para comparar "prontuario" com "Prontuário". */
export function normalizar(t: string) {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/** Filtra só as telas que a pessoa já vê no menu; começa-por vem antes de contém. */
export function filtrarTelas(telas: TelaBusca[], termo: string, limite = 6): TelaBusca[] {
  const t = normalizar(termo);
  if (!t) return [];
  const vistos = new Set<string>();
  const unicas = telas.filter((x) => (vistos.has(x.to) ? false : (vistos.add(x.to), true)));
  const pontos = (x: TelaBusca) => {
    const l = normalizar(x.label);
    if (l.startsWith(t)) return 0;
    if (l.includes(t)) return 1;
    if (normalizar(x.grupo).includes(t)) return 2;
    return -1;
  };
  return unicas
    .map((x) => ({ x, p: pontos(x) }))
    .filter((r) => r.p >= 0)
    .sort((a, b) => a.p - b.p)
    .slice(0, limite)
    .map((r) => r.x);
}

/** "3*789..." → quantidade 3 e código; sem asterisco → quantidade 1. */
export function lerMultiplicador(entrada: string): { quantidade: number; codigo: string } {
  const m = entrada.trim().match(/^(\d+(?:[.,]\d{1,3})?)\s*\*\s*(.+)$/);
  if (!m) return { quantidade: 1, codigo: entrada.trim() };
  const q = Number((m[1] ?? "").replace(",", "."));
  return q > 0 ? { quantidade: q, codigo: (m[2] ?? "").trim() } : { quantidade: 1, codigo: entrada.trim() };
}
