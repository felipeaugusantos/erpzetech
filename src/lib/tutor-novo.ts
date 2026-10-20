// Tutor novo cadastrado dentro do cadastro do pet (sem passar por Clientes). Sem dependência de tela nem de banco.

export type TutorOpcao = { id: string; nome: string; telefone?: string | null };

const digitos = (s: string) => s.replace(/\D/g, "");

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

/** Tutores que parecem ser a mesma pessoa: mesmo telefone (pelos 10 últimos dígitos) ou mesmo nome. */
export function tutoresParecidos(
  tutores: readonly TutorOpcao[],
  nome: string,
  telefone: string,
): TutorOpcao[] {
  const fone = digitos(telefone).slice(-10);
  const nomeNovo = nomeParaComparar(nome);
  return tutores
    .filter((t) => {
      if (fone.length === 10 && digitos(t.telefone ?? "").slice(-10) === fone) return true;
      return nomeNovo.length >= 2 && nomeParaComparar(t.nome) === nomeNovo;
    })
    .slice(0, 5);
}
