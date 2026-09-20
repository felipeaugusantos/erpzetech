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
    const resposta = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${data.cnpj}`, {
      headers: { accept: "application/json" },
    });

    if (resposta.status === 404) throw new Error("CNPJ não encontrado na base da Receita.");
    if (!resposta.ok) {
      const corpo = await resposta.text();
      throw new Error(`Consulta de CNPJ indisponível agora [${resposta.status}]: ${corpo.slice(0, 200)}`);
    }

    const j = (await resposta.json()) as Record<string, unknown>;
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
