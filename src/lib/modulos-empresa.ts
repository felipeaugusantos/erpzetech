/** Liberações explícitas da empresa são lidas do banco; não alteram perfis nem dados fiscais. */
export type LiberacoesEmpresa = {
  modulos_liberados?: string[] | null;
  ramo_atividade?: string | null;
};

export function obrasLiberadasEmpresa(empresa?: LiberacoesEmpresa | null) {
  return empresa?.modulos_liberados?.includes("obras") === true ||
    (empresa?.ramo_atividade ?? "construcao") === "construcao";
}