/* eslint-disable @typescript-eslint/no-explicit-any -- cliente Supabase injetado pelas funções de servidor */
// Quem pode operar a nota fiscal e de qual empresa ela é. Fica à parte das funções de servidor para ser testado.

export const PAPEIS_FISCAIS = ["administrador", "gestor", "financeiro", "vendedor", "caixa"] as const;

export const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** Exige um papel fiscal e devolve a empresa de quem chama. */
export async function exigirPapelFiscal(supabase: any, userId: string) {
  const respostas = await Promise.all(
    PAPEIS_FISCAIS.map((r) => supabase.rpc("has_role", { _user_id: userId, _role: r })),
  );
  if (!respostas.some((r: any) => r.data === true)) {
    throw new Error("Somente administrador, gestor, financeiro, vendedor ou caixa pode operar notas fiscais.");
  }
  const { data: perfil, error } = await supabase
    .from("profiles")
    .select("tenant_id, empresa_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!perfil?.tenant_id) throw new Error("Perfil sem empresa vinculada.");
  return { tenantId: perfil.tenant_id as string, empresaId: (perfil.empresa_id as string) ?? null };
}

/**
 * Lê a nota depois de conferir o papel fiscal e a empresa. `userId` é obrigatório: era opcional, e as
 * funções de servidor não o passavam, então a conferência nunca rodava.
 */
export async function carregarNota(supabase: any, nfeId: string, userId: string) {
  const escopo = await exigirPapelFiscal(supabase, userId);
  const { data: nota, error } = await supabase
    .from("nfe")
    .select(
      "id, tenant_id, empresa_id, numero, serie, situacao, ambiente, natureza_operacao, cfop, valor_produtos, valor_desconto, valor_frete, valor_total, valor_icms, valor_icms_st, valor_pis, valor_cofins, valor_iss, base_icms, base_icms_st, cliente_id, pendencias, provider_id, provider_status, chave, protocolo, mensagem",
    )
    .eq("id", nfeId)
    .maybeSingle();
  if (error) throw error;
  if (!nota) throw new Error("Nota fiscal não encontrada");
  const outraEmpresa = escopo.empresaId && nota.empresa_id && nota.empresa_id !== escopo.empresaId;
  if (nota.tenant_id !== escopo.tenantId || outraEmpresa) {
    throw new Error("Nota fiscal não encontrada");
  }
  return nota;
}

/** CNPJs das empresas do cliente: o que a conta do emissor mostra a ele. */
export async function cnpjsDaEmpresa(supabase: any, tenantId: string): Promise<string[]> {
  const { data, error } = await supabase.from("empresas").select("cnpj").eq("tenant_id", tenantId);
  if (error) throw error;
  return ((data ?? []) as { cnpj: string | null }[]).map((e) => soDigitos(e.cnpj)).filter(Boolean);
}

/** A conta do emissor é compartilhada entre os clientes: cada um vê só as suas empresas e certificados. */
export function filtrarPorCnpj<T extends { cpfCnpj: string }>(lista: T[], cnpjs: string[]): T[] {
  return lista.filter((i) => cnpjs.includes(soDigitos(i.cpfCnpj)));
}
