/* eslint-disable @typescript-eslint/no-explicit-any -- cliente Supabase injetado pelas funções de servidor */
// Regras do acesso do contador aos XMLs. Fica à parte das funções de servidor para ser testado.
// O banco já limita o que o contador lê (política RLS por empresa); aqui se confere de novo, em código, porque a
// busca do XML usa a conta compartilhada do emissor.

/** Recusa o contador (lógica da trava das demais funções de servidor); na dúvida, recusa. */
export async function recusarContador(supabase: any) {
  const { data, error } = await supabase.rpc("eh_contador_restrito");
  if (error || data !== false) throw new Error("Seu perfil não tem acesso a esta operação");
}

export const SITUACOES_COM_XML = ["autorizada", "cancelada"] as const;

export type AcessoContador = {
  empresa_id: string;
  empresa_nome: string | null;
  cnpj: string | null;
  pode_editar_tributos: boolean;
};

/** Acesso ativo do contador logado; falha se não for contador, se o acesso foi revogado ou se algo estranho voltar. */
export async function exigirContador(supabase: any): Promise<AcessoContador> {
  const { data, error } = await supabase.rpc("contador_meu_acesso");
  if (error) throw new Error("Não foi possível conferir o acesso de contador");
  const linhas = Array.isArray(data) ? data : [];
  if (linhas.length !== 1 || !linhas[0]?.empresa_id) {
    throw new Error("Acesso de contador não encontrado ou revogado");
  }
  return linhas[0] as AcessoContador;
}

/** Confere a nota contra o acesso. Devolve só o que a busca do XML precisa. */
export function conferirNotaDoContador(
  nota: {
    empresa_id?: string | null;
    situacao?: string | null;
    provider_id?: string | null;
    chave?: string | null;
    ambiente?: string | null;
  } | null,
  acesso: Pick<AcessoContador, "empresa_id">,
) {
  // mesma resposta para nota inexistente, de outra empresa ou fora da situação: não revela qual
  if (
    !nota ||
    !nota.empresa_id ||
    nota.empresa_id !== acesso.empresa_id ||
    !(SITUACOES_COM_XML as readonly string[]).includes(String(nota.situacao ?? ""))
  ) {
    throw new Error("Nota fiscal não encontrada");
  }
  if (!nota.provider_id) throw new Error("O XML desta nota ainda não está disponível");
  return {
    providerId: String(nota.provider_id),
    chave: nota.chave ? String(nota.chave) : null,
    ambiente: nota.ambiente === "producao" ? ("producao" as const) : ("homologacao" as const),
  };
}

/** Mês no formato AAAA-MM -> [início, fim) em datas ISO. */
export function intervaloDoMes(mes: string): { inicio: string; fim: string } {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(mes ?? "");
  if (!m) throw new Error("Informe o mês no formato AAAA-MM");
  const ano = Number(m[1]);
  const mm = Number(m[2]);
  const prox = mm === 12 ? `${ano + 1}-01` : `${ano}-${String(mm + 1).padStart(2, "0")}`;
  return { inicio: `${m[1]}-${m[2]}-01`, fim: `${prox}-01` };
}
