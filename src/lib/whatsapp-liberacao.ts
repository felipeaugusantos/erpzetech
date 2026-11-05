// Trava do WhatsApp por empresa: só as empresas listadas em WHATSAPP_EMPRESAS_LIBERADAS (ids separados por vírgula, ponto e
// vírgula, espaço ou quebra de linha) podem conectar o número e entrar na rodada de envio. Lista vazia ou ausente = ninguém.
// Sem banco nem rede, para os testes rodarem no Node.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const MENSAGEM_NAO_LIBERADA =
  "O WhatsApp ainda não está liberado para esta empresa. Fale com o suporte da EZRA.";

/** Lê a lista do ambiente: ignora o que não for um id de empresa válido e não diferencia maiúsculas. */
export function listaDeEmpresasLiberadas(bruto: string | null | undefined): Set<string> {
  const ids = (bruto ?? "")
    .split(/[\s,;]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => UUID.test(t));
  return new Set(ids);
}

export function empresaLiberada(
  tenantId: string | null | undefined,
  liberadas: ReadonlySet<string>,
): boolean {
  return !!tenantId && liberadas.has(tenantId.trim().toLowerCase());
}

/** Separa os itens reservados pelo banco entre os que podem ser enviados e os de empresas fora da lista. */
export function separarPorLiberacao<T extends { tenant_id: string }>(
  itens: readonly T[],
  liberadas: ReadonlySet<string>,
): { liberados: T[]; bloqueados: T[] } {
  const liberados: T[] = [];
  const bloqueados: T[] = [];
  for (const item of itens)
    (empresaLiberada(item.tenant_id, liberadas) ? liberados : bloqueados).push(item);
  return { liberados, bloqueados };
}
