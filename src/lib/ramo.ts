/**
 * Módulo do sistema (campo "ramo de atividade" da empresa): define os recursos do segmento e o cadastro de produto.
 * Os quatro primeiros são os módulos com cadastro de produto próprio (src/lib/modulos-produto.ts). Os demais ramos
 * seguem com o cadastro padrão.
 */
export const ramos = [
  { value: "construcao", label: "Material de Construção" },
  { value: "petshop", label: "Pet Shop" },
  { value: "clinica", label: "Clínica Veterinária" },
  { value: "lavarapido", label: "Lava-Rápido" },
  { value: "roupas", label: "Roupas e calçados" },
  { value: "autopecas", label: "Autopeças" },
  { value: "agro", label: "Agro" },
  { value: "eletrica_hidraulica", label: "Elétrica e hidráulica" },
  { value: "distribuidora", label: "Distribuidora / atacado" },
  { value: "papelaria", label: "Papelaria" },
  { value: "restaurante", label: "Restaurante e lanchonete" },
  { value: "outro", label: "Outro varejo de produtos" },
] as const;

/** Os módulos com cadastro de produto próprio, na ordem da escolha. */
export const ramosModulo = ramos.slice(0, 4);
/** Demais ramos, sem cadastro de produto próprio. */
export const ramosOutros = ramos.slice(4);

export const labelRamo = (v: string | null | undefined) =>
  ramos.find((r) => r.value === v)?.label ?? "Material de Construção";

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
