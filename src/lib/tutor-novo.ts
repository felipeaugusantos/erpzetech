// Tutor novo cadastrado dentro do cadastro do pet (sem passar por Clientes). Sem dependência de tela nem de banco.

import { limparDocumento } from "./cnpj-alfa.ts";

export type DadosTutor = {
  documento: string;
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
  nome_fantasia?: string;
  email?: string;
  whatsapp?: string;
  inscricao_estadual?: string;
  observacoes?: string;
};

export const dadosTutorVazios: DadosTutor = {
  documento: "", cep: "", endereco: "", numero: "", complemento: "", bairro: "", cidade: "", estado: "",
};

export function dadosTutorParaSalvar(dados: DadosTutor) {
  const documento = limparDocumento(dados.documento);
  const juridica = documento.length > 11 || /[A-Z]/.test(documento);
  return {
    tipo: juridica ? "PJ" as const : "PF" as const,
    cpf: !juridica && documento ? documento : null,
    cnpj: juridica && documento ? documento : null,
    cep: dados.cep.replace(/\D/g, "") || null,
    endereco: dados.endereco.trim() || null,
    numero: dados.numero.trim() || null,
    complemento: dados.complemento.trim() || null,
    bairro: dados.bairro.trim() || null,
    cidade: dados.cidade.trim() || null,
    estado: dados.estado.trim().toUpperCase() || null,
    ...(dados.nome_fantasia !== undefined ? { nome_fantasia: dados.nome_fantasia.trim() || null } : {}),
    ...(dados.email !== undefined ? { email: dados.email.trim() || null } : {}),
    ...(dados.whatsapp !== undefined ? { whatsapp: dados.whatsapp.trim() || null } : {}),
    ...(dados.inscricao_estadual !== undefined ? { inscricao_estadual: dados.inscricao_estadual.trim() || null } : {}),
    ...(dados.observacoes !== undefined ? { observacoes: dados.observacoes.trim() || null } : {}),
  };
}

export type TutorOpcao = { id: string; nome: string; telefone?: string | null };

const digitos = (s: string) => s.replace(/\D/g, "");

/** Telefone sem o 55 do país (quando vem com ele): sobram o DDD de 2 dígitos e o número de 8 ou 9; telefone curto demais não serve para comparar. */
export function telefoneNormalizado(telefone: string): string {
  let d = digitos(telefone);
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? d : "";
}

/** Nome sem acento, em minúsculas e com espaços simples, para comparar nomes iguais escritos de jeitos diferentes. */
export function nomeParaComparar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Mensagem do primeiro problema do tutor novo (nome e telefone opcional com DDD), ou nulo. */
export function erroDoTutorNovo(nome: string, telefone: string): string | null {
  const n = nome.trim();
  if (n.length < 2 || n.length > 120) return "Informe o nome do tutor (de 2 a 120 letras)";
  const fone = telefone.trim();
  if (fone) {
    const d = digitos(fone);
    if (d.length < 10 || d.length > 13 || fone.length > 30)
      return "Telefone inválido: informe com DDD";
  }
  return null;
}

/** Tutores que parecem ser a mesma pessoa: mesmo telefone (DDD e número inteiros, com ou sem o 55) ou mesmo nome. */
export function tutoresParecidos(
  tutores: readonly TutorOpcao[],
  nome: string,
  telefone: string,
): TutorOpcao[] {
  const fone = telefoneNormalizado(telefone);
  const nomeNovo = nomeParaComparar(nome);
  return tutores
    .filter((t) => {
      if (fone && telefoneNormalizado(t.telefone ?? "") === fone) return true;
      return nomeNovo.length >= 2 && nomeParaComparar(t.nome) === nomeNovo;
    })
    .slice(0, 5);
}
