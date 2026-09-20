import { createServerFn } from "@tanstack/react-start";

/** Dados públicos da empresa retornados pela consulta de CNPJ. */
export type DadosCnpj = {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  cnae: string;
  cnae_descricao: string;
  cnae_secundarios: string;
  telefone: string;
  email: string;
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
  codigo_municipio: string;
  situacao: string;
};

const digitos = (v: string) => (v ?? "").replace(/\D/g, "");

/** Formata o código CNAE no padrão 0000-0/00. */
function formatarCnae(codigo: unknown): string {
  const d = digitos(String(codigo ?? ""));
  if (d.length !== 7) return d;
  return `${d.slice(0, 4)}-${d.slice(4, 5)}/${d.slice(5)}`;
}

/**
 * Consulta o CNPJ na base pública da Receita (BrasilAPI) e devolve
 * razão social, nome fantasia, CNAE principal, secundários e endereço.
 */
export const consultarCnpj = createServerFn({ method: "GET" })
  .inputValidator((data: { cnpj: string }) => {
    const cnpj = digitos(data?.cnpj ?? "");
    if (cnpj.length !== 14) throw new Error("Informe um CNPJ com 14 números.");
    return { cnpj };
  })
  .handler(async ({ data }): Promise<DadosCnpj> => {
    const cabecalhos = {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 (compatible; ERPZeTech/1.0)",
    };

    // 1ª fonte: BrasilAPI. 2ª fonte: CNPJa aberto (usada quando a primeira bloqueia).
    let j: Record<string, unknown> | null = null;
    let falha = "";

    const brasil = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${data.cnpj}`, {
      headers: cabecalhos,
    }).catch(() => null);

    if (brasil?.status === 404) throw new Error("CNPJ não encontrado na base da Receita.");
    if (brasil?.ok) {
      j = (await brasil.json()) as Record<string, unknown>;
    } else {
      falha = `BrasilAPI [${brasil?.status ?? "sem resposta"}]`;
      const cnpja = await fetch(`https://open.cnpja.com/office/${data.cnpj}`, {
        headers: cabecalhos,
      }).catch(() => null);

      if (cnpja?.status === 404) throw new Error("CNPJ não encontrado na base da Receita.");
      if (!cnpja?.ok) {
        throw new Error(
          `Consulta de CNPJ indisponível agora (${falha} · CNPJa [${cnpja?.status ?? "sem resposta"}]). Preencha os dados manualmente.`,
        );
      }
      j = normalizarCnpja((await cnpja.json()) as Record<string, unknown>);
    }

    const secundarios = Array.isArray(j["cnaes_secundarios"])
      ? (j["cnaes_secundarios"] as Array<Record<string, unknown>>)
          .map((c) => formatarCnae(c["codigo"]))
          .filter(Boolean)
      : [];

    const telefone = [j["ddd_telefone_1"], j["ddd_telefone_2"]]
      .map((t) => String(t ?? "").trim())
      .find((t) => t.length > 0);

    return {
      cnpj: data.cnpj,
      razao_social: String(j["razao_social"] ?? ""),
      nome_fantasia: String(j["nome_fantasia"] ?? ""),
      cnae: formatarCnae(j["cnae_fiscal"]),
      cnae_descricao: String(j["cnae_fiscal_descricao"] ?? ""),
      cnae_secundarios: secundarios.join(", "),
      telefone: telefone ?? "",
      email: String(j["email"] ?? ""),
      cep: digitos(String(j["cep"] ?? "")),
      endereco: String(j["logradouro"] ?? ""),
      numero: String(j["numero"] ?? ""),
      complemento: String(j["complemento"] ?? ""),
      bairro: String(j["bairro"] ?? ""),
      cidade: String(j["municipio"] ?? ""),
      estado: String(j["uf"] ?? ""),
      codigo_municipio: String(j["codigo_municipio_ibge"] ?? j["codigo_municipio"] ?? ""),
      situacao: String(j["descricao_situacao_cadastral"] ?? ""),
    };
  });

/** Converte a resposta do CNPJa aberto no mesmo formato da BrasilAPI. */
function normalizarCnpja(o: Record<string, unknown>): Record<string, unknown> {
  const company = (o["company"] ?? {}) as Record<string, unknown>;
  const address = (o["address"] ?? {}) as Record<string, unknown>;
  const principal = (o["mainActivity"] ?? {}) as Record<string, unknown>;
  const fones = Array.isArray(o["phones"]) ? (o["phones"] as Array<Record<string, unknown>>) : [];
  const emails = Array.isArray(o["emails"]) ? (o["emails"] as Array<Record<string, unknown>>) : [];
  const secundarias = Array.isArray(o["sideActivities"])
    ? (o["sideActivities"] as Array<Record<string, unknown>>)
    : [];

  return {
    razao_social: company["name"] ?? "",
    nome_fantasia: o["alias"] ?? "",
    cnae_fiscal: principal["id"] ?? "",
    cnae_fiscal_descricao: principal["text"] ?? "",
    cnaes_secundarios: secundarias.map((a) => ({ codigo: a["id"] })),
    ddd_telefone_1: fones[0] ? `(${fones[0]["area"]}) ${fones[0]["number"]}` : "",
    email: emails[0]?.["address"] ?? "",
    cep: address["zip"] ?? "",
    logradouro: address["street"] ?? "",
    numero: address["number"] ?? "",
    complemento: address["details"] ?? "",
    bairro: address["district"] ?? "",
    municipio: address["city"] ?? "",
    uf: address["state"] ?? "",
    codigo_municipio: address["municipality"] ?? "",
    descricao_situacao_cadastral: ((o["status"] ?? {}) as Record<string, unknown>)["text"] ?? "",
  };
}
