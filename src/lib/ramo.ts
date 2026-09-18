/** Ramo de atividade da empresa — define recursos específicos por segmento. */
export const ramos = [
  { value: "construcao", label: "Materiais de construção" },
  { value: "roupas", label: "Roupas e calçados" },
  { value: "autopecas", label: "Autopeças" },
  { value: "agro", label: "Agro" },
  { value: "eletrica_hidraulica", label: "Elétrica e hidráulica" },
  { value: "distribuidora", label: "Distribuidora / atacado" },
  { value: "papelaria", label: "Papelaria" },
  { value: "outro", label: "Outro varejo de produtos" },
] as const;

export const labelRamo = (v: string | null | undefined) =>
  ramos.find((r) => r.value === v)?.label ?? "Materiais de construção";

/** Grade de tamanhos só faz sentido para roupas e calçados. */
export const usaGradeTamanho = (ramo: string | null | undefined) => ramo === "roupas";

export const tamanhosSugeridos = [
  "PP",
  "P",
  "M",
  "G",
  "GG",
  "XG",
  "34",
  "35",
  "36",
  "37",
  "38",
  "39",
  "40",
  "41",
  "42",
  "43",
  "44",
];
