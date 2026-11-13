export type EnderecoCep = { endereco: string; bairro: string; cidade: string; estado: string };

export function normalizarCep(cep: string): string {
  return cep.replace(/\D/g, "");
}

export async function consultarCep(cep: string, signal?: AbortSignal): Promise<EnderecoCep> {
  const digitos = normalizarCep(cep);
  if (!/^\d{8}$/.test(digitos)) throw new Error("Informe um CEP com 8 números.");
  const resposta = await fetch(`https://viacep.com.br/ws/${digitos}/json/`, { signal: signal ?? null });
  if (!resposta.ok) throw new Error("Não foi possível consultar o CEP. Preencha o endereço manualmente.");
  const dados: unknown = await resposta.json();
  if (!dados || typeof dados !== "object") throw new Error("Resposta inválida ao consultar o CEP.");
  const d = dados as Record<string, unknown>;
  if (d['erro']) throw new Error("CEP não encontrado. Confira o número ou preencha o endereço manualmente.");
  if (typeof d['localidade'] !== "string" || typeof d['uf'] !== "string") throw new Error("Resposta inválida ao consultar o CEP.");
  return {
    endereco: typeof d['logradouro'] === "string" ? d['logradouro'] : "",
    bairro: typeof d['bairro'] === "string" ? d['bairro'] : "",
    cidade: d['localidade'],
    estado: d['uf'],
  };
}

/** Preserve fields edited while the lookup was in flight, and unrelated tutor details. */
export function aplicarEnderecoCep<T extends EnderecoCep>(atual: T, inicio: EnderecoCep, encontrado: EnderecoCep): T {
  const resultado = { ...atual };
  for (const chave of ["endereco", "bairro", "cidade", "estado"] as const) {
    if (encontrado[chave].trim() && atual[chave] === inicio[chave]) resultado[chave] = encontrado[chave];
  }
  return resultado;
}