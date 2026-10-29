// Nomes de exibição dos três planos do EZRA ERP. Só o texto mostrado muda: o código interno (balcao, loja, rede) continua sendo
// o identificador no banco, nas assinaturas e nas chamadas de API. Para trocar um nome de novo, é aqui (e na migration de nomes).

export type CodigoPlano = "balcao" | "loja" | "rede";

export const NOME_DO_PLANO: Record<CodigoPlano, string> = {
  balcao: "Essencial",
  loja: "Profissional",
  rede: "Empresarial",
};

/** Nomes que o banco trazia antes da troca (só trocamos o que ainda estiver assim, nunca um nome que a equipe tenha editado). */
const NOME_ANTERIOR: Record<CodigoPlano, string> = { balcao: "Balcão", loja: "Loja", rede: "Rede" };

const ehCodigo = (c: unknown): c is CodigoPlano => c === "balcao" || c === "loja" || c === "rede";

/** Nome para mostrar a partir do código. Valor que não é de um plano (ex.: "nao_sei") volta como veio. */
export function nomeDoPlano(codigo: string | null | undefined): string {
  if (!codigo) return "";
  return ehCodigo(codigo) ? NOME_DO_PLANO[codigo] : codigo;
}

/** Plano lido do banco com os nomes de exibição novos: o nome e o item "Tudo do …" dos recursos. O resto fica igual. */
export function comNomeDeExibicao<T extends { codigo: string; nome: string; recursos: string[] }>(
  plano: T,
): T {
  if (!ehCodigo(plano.codigo)) return plano;
  const nome =
    plano.nome === NOME_ANTERIOR[plano.codigo] ? NOME_DO_PLANO[plano.codigo] : plano.nome;
  const recursos = plano.recursos.map((r) =>
    (Object.keys(NOME_ANTERIOR) as CodigoPlano[]).reduce(
      (txt, c) => (txt === `Tudo do ${NOME_ANTERIOR[c]}` ? `Tudo do ${NOME_DO_PLANO[c]}` : txt),
      r,
    ),
  );
  return { ...plano, nome, recursos };
}
