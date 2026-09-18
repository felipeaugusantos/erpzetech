import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/** Catálogo de planos da Ze Tech. */
export type PlanoSaas = {
  id: string;
  codigo: string;
  nome: string;
  resumo: string | null;
  valor_mensal: number;
  prazo_meses: number;
  dias_teste: number;
  valor_filial_extra: number;
  valor_implantacao: number;
  recursos: string[];
  ordem: number;
  ativo: boolean;
};

export type FaturaSaas = {
  id: string;
  cliente_id: string;
  competencia: string | null;
  descricao: string;
  tipo: string;
  valor: number;
  valor_pago: number;
  vencimento: string;
  pago_em: string | null;
  forma_pagamento: string | null;
};

export type ClienteSaas = {
  id: string;
  nome: string;
  documento: string | null;
  responsavel: string | null;
  email: string | null;
  whatsapp: string | null;
  cidade: string | null;
  uf: string | null;
  plano_id: string | null;
  tenant_id: string | null;
  inicio: string;
  prazo_meses: number;
  dia_vencimento: number;
  filiais_extras: number;
  situacao: string;
  teste_ate: string | null;
  implantacao_paga: boolean;
  observacoes: string | null;
};

export const SITUACAO_SAAS: Record<string, string> = {
  teste: "Em teste grátis",
  ativo: "Ativo",
  suspenso: "Suspenso",
  cancelado: "Cancelado",
};

export const TIPO_FATURA_SAAS: Record<string, string> = {
  mensalidade: "Mensalidade",
  filial_extra: "Filial extra",
  implantacao: "Implantação",
  avulso: "Avulso",
};

function hoje() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dia(data: string) {
  const [a, m, d] = data.slice(0, 10).split("-").map(Number);
  return new Date(a ?? 2026, (m ?? 1) - 1, d ?? 1);
}

export function diasEntre(data: string) {
  return Math.round((dia(data).getTime() - hoje().getTime()) / 86_400_000);
}

export type ResumoCliente = {
  cliente: ClienteSaas;
  plano: PlanoSaas | null;
  /** Mensalidade + filiais extras. */
  mensal: number;
  fim: string;
  diasRestantes: number;
  diasTeste: number | null;
  proximoVencimento: string | null;
  proximoValor: number;
  aberto: number;
  atrasado: number;
  pagoTotal: number;
  /** pago = nada em aberto; aberto = a vencer; atrasado = passou do vencimento. */
  status: "pago" | "aberto" | "atrasado";
  faturas: FaturaSaas[];
};

/** Soma prazo em meses mantendo o dia, com ajuste de fim de mês. */
function fimContrato(inicio: string, meses: number) {
  const d = dia(inicio);
  const alvo = new Date(d.getFullYear(), d.getMonth() + meses, d.getDate());
  return alvo.toISOString().slice(0, 10);
}

export function resumirCliente(
  cliente: ClienteSaas,
  planos: PlanoSaas[],
  faturas: FaturaSaas[],
): ResumoCliente {
  const plano = planos.find((p) => p.id === cliente.plano_id) ?? null;
  const minhas = faturas
    .filter((f) => f.cliente_id === cliente.id)
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));

  const abertas = minhas.filter((f) => Number(f.valor_pago) < Number(f.valor));
  const aberto = abertas.reduce((s, f) => s + (Number(f.valor) - Number(f.valor_pago)), 0);
  const atrasadas = abertas.filter((f) => diasEntre(f.vencimento) < 0);
  const atrasado = atrasadas.reduce((s, f) => s + (Number(f.valor) - Number(f.valor_pago)), 0);
  const pagoTotal = minhas.reduce((s, f) => s + Number(f.valor_pago), 0);
  const proxima = abertas[0] ?? null;
  const fim = fimContrato(cliente.inicio, cliente.prazo_meses);

  return {
    cliente,
    plano,
    mensal:
      (plano ? Number(plano.valor_mensal) : 0) +
      cliente.filiais_extras * (plano ? Number(plano.valor_filial_extra) : 0),
    fim,
    diasRestantes: diasEntre(fim),
    diasTeste: cliente.teste_ate ? diasEntre(cliente.teste_ate) : null,
    proximoVencimento: proxima?.vencimento ?? null,
    proximoValor: proxima ? Number(proxima.valor) - Number(proxima.valor_pago) : 0,
    aberto,
    atrasado,
    pagoTotal,
    status: atrasado > 0 ? "atrasado" : aberto > 0 ? "aberto" : "pago",
    faturas: minhas,
  };
}

/** Só operadores da Ze Tech enxergam clientes, planos e cobranças. */
export function useSaasOperador() {
  return useQuery({
    queryKey: ["saas-operador"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("eh_saas_operador");
      if (error) throw error;
      return Boolean(data);
    },
    staleTime: 5 * 60_000,
  });
}

export function useSaasDados(habilitado = true) {
  return useQuery({
    queryKey: ["saas-dados"],
    enabled: habilitado,
    queryFn: async () => {
      const [planosRes, clientesRes, faturasRes] = await Promise.all([
        supabase.from("saas_planos").select("*").order("ordem"),
        supabase.from("saas_clientes").select("*").order("nome"),
        supabase.from("saas_faturas").select("*").order("vencimento"),
      ]);
      if (planosRes.error) throw planosRes.error;
      if (clientesRes.error) throw clientesRes.error;
      if (faturasRes.error) throw faturasRes.error;

      const planos = (planosRes.data ?? []) as PlanoSaas[];
      const faturas = (faturasRes.data ?? []) as FaturaSaas[];
      const clientes = (clientesRes.data ?? []) as ClienteSaas[];
      const resumos = clientes.map((c) => resumirCliente(c, planos, faturas));
      return { planos, clientes, faturas, resumos };
    },
  });
}
