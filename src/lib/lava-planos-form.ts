// Formulário do plano do lava rápido: valores iniciais, leitura do que veio do banco e conferência antes de salvar.

export type FormPlano = {
  id?: string;
  nome: string;
  servico_id: string;
  lavagens: string;
  validade_dias: string;
  tipo: string;
  preco: string;
  ativo: boolean;
};

export const planoVazio: FormPlano = {
  nome: "",
  servico_id: "",
  lavagens: "4",
  validade_dias: "30",
  tipo: "",
  preco: "",
  ativo: true,
};

export type PlanoLava = {
  id: string;
  nome: string;
  servico_id: string;
  lavagens: number;
  validade_dias: number;
  tipo: string | null;
  preco: number;
  ativo: boolean;
};

export function formDoPlano(p: PlanoLava): FormPlano {
  return {
    id: p.id,
    nome: p.nome,
    servico_id: p.servico_id,
    lavagens: String(p.lavagens),
    validade_dias: String(p.validade_dias),
    tipo: p.tipo ?? "",
    preco: String(p.preco),
    ativo: p.ativo,
  };
}

/** Confere o formulário e devolve o que vai para o banco (ou lança a mensagem para mostrar). */
export function dadosDoPlano(form: FormPlano) {
  if (!form.nome.trim()) throw new Error("Informe o nome do plano.");
  if (!form.servico_id) throw new Error("Escolha o serviço do plano.");
  const lav = Number(form.lavagens);
  if (!Number.isInteger(lav) || lav < 2 || lav > 60)
    throw new Error("O plano precisa ter de 2 a 60 lavagens.");
  const val = Number(form.validade_dias);
  if (!Number.isInteger(val) || val < 7 || val > 366)
    throw new Error("A validade precisa ficar entre 7 e 366 dias.");
  const preco = Number(form.preco.replace(",", "."));
  if (!Number.isFinite(preco) || preco <= 0) throw new Error("Informe o preço do plano.");
  return {
    ...(form.id ? { id: form.id } : {}),
    nome: form.nome.trim(),
    servico_id: form.servico_id,
    lavagens: lav,
    validade_dias: val,
    tipo: form.tipo,
    preco,
    ativo: form.ativo,
  };
}
