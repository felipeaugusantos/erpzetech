export const DOSES_APLICACAO = [
  { value: "auto", label: "Automática pelo histórico" },
  { value: "1", label: "1ª dose" },
  { value: "2", label: "2ª dose" },
  { value: "3", label: "3ª dose" },
  { value: "reforco", label: "Reforço" },
] as const;

/** Omissão preserva a sequência anterior; seleção explícita registra a dose informada pelo veterinário. */
export function dadosDoseAplicacao(valor: string): { dose_tipo?: "serie" | "reforco"; dose_numero?: number } {
  if (valor === "auto") return {};
  if (valor === "reforco") return { dose_tipo: "reforco", dose_numero: 1 };
  if (valor === "1" || valor === "2" || valor === "3") {
    return { dose_tipo: "serie", dose_numero: Number(valor) };
  }
  throw new Error("Escolha 1ª, 2ª, 3ª dose ou reforço");
}