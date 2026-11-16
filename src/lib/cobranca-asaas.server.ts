// Cobrança automática pelo Asaas (só servidor). Variáveis de ambiente:
//   ASAAS_API_KEY        chave da API (obrigatória; nunca vai ao navegador nem a log)
//   ASAAS_API_URL        base da API; padrão: sandbox (https://api-sandbox.asaas.com/v3). Em produção, a URL de produção do Asaas.
//   ASAAS_WEBHOOK_TOKEN  token que o Asaas manda no cabeçalho asaas-access-token (não pode ser a chave da API)
// Repetir a rodada é seguro: antes de criar, procura a cobrança pela referência externa (id da fatura), e o banco só aceita um vínculo.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  montarClienteAsaas,
  montarCobrancaAsaas,
  type FaturaPendente,
} from "@/lib/cobranca-gateway";

const URL_PADRAO = "https://api-sandbox.asaas.com/v3";
const TEMPO_LIMITE_MS = 60_000;

export class ErroGateway extends Error {}

function configuracao() {
  const chave = process.env["ASAAS_API_KEY"];
  if (!chave) throw new ErroGateway("ASAAS_API_KEY não configurada");
  return { chave, base: (process.env["ASAAS_API_URL"] ?? URL_PADRAO).replace(/\/+$/, "") };
}

export function gatewayConfigurado(): boolean {
  return Boolean(process.env["ASAAS_API_KEY"]);
}

async function chamar<T>(metodo: "GET" | "POST", caminho: string, corpo?: unknown): Promise<T> {
  const { chave, base } = configuracao();
  const resposta = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: {
      access_token: chave,
      "content-type": "application/json",
      "user-agent": "EZRA-ERP/1.0",
    },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
  });
  const texto = await resposta.text();
  let json: unknown = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }
  if (!resposta.ok) {
    const erros = (json as { errors?: { description?: string }[] } | null)?.errors;
    const detalhe = erros
      ?.map((e) => e.description)
      .filter(Boolean)
      .join("; ");
    throw new ErroGateway(`Asaas ${resposta.status}${detalhe ? `: ${detalhe}` : ""}`);
  }
  return json as T;
}

type Lista<T> = { data?: T[] };

async function clienteNoGateway(p: FaturaPendente): Promise<string> {
  if (p.gateway_cliente_id) return p.gateway_cliente_id;
  const pedido = montarClienteAsaas(p);
  // já existe um cliente com este documento (cadastro anterior ou rodada interrompida)? reaproveita
  const achados = await chamar<Lista<{ id: string }>>(
    "GET",
    `/customers?cpfCnpj=${encodeURIComponent(pedido.cpfCnpj)}&limit=1`,
  );
  let id = achados.data?.[0]?.id;
  if (!id) id = (await chamar<{ id: string }>("POST", "/customers", pedido)).id;
  const { data, error } = await supabaseAdmin.rpc("saas_cobranca_vincular_cliente", {
    p_cliente: p.cliente_id,
    p_gateway_id: id,
  });
  if (error)
    throw new ErroGateway(`Não foi possível guardar o cliente do gateway: ${error.message}`);
  return data;
}

type CobrancaGateway = { id: string; invoiceUrl?: string; bankSlipUrl?: string; status?: string };

async function cobrancaNoGateway(
  p: FaturaPendente,
  clienteGateway: string,
  hoje: string,
): Promise<CobrancaGateway> {
  const achadas = await chamar<Lista<CobrancaGateway>>(
    "GET",
    `/payments?externalReference=${encodeURIComponent(p.fatura_id)}&limit=1`,
  );
  const existente = achadas.data?.[0];
  if (existente?.id) return existente;
  return chamar<CobrancaGateway>("POST", "/payments", montarCobrancaAsaas(p, clienteGateway, hoje));
}

export type ResumoRodada = {
  faturasGeradas: number;
  cobrancasCriadas: number;
  falhas: { faturaId: string; motivo: string }[];
  suspensos: number;
  reativados: number;
};

/**
 * Rodada diária: gera as faturas do mês, cria no gateway as cobranças que faltam (até `limite` por chamada) e reavalia a
 * inadimplência (suspende além da tolerância; reativa quem quitou). Uma falha em uma fatura não impede as outras.
 */
export async function rodadaDeCobranca(limite = 20): Promise<ResumoRodada> {
  configuracao(); // sem chave: falha antes de mexer em qualquer coisa
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const resumo: ResumoRodada = {
    faturasGeradas: 0,
    cobrancasCriadas: 0,
    falhas: [],
    suspensos: 0,
    reativados: 0,
  };

  const gerar = await supabaseAdmin.rpc("saas_gerar_faturas_auto");
  if (gerar.error) throw new ErroGateway(`Falha ao gerar faturas: ${gerar.error.message}`);
  resumo.faturasGeradas = gerar.data ?? 0;

  const pendentes = await supabaseAdmin.rpc("saas_cobranca_pendentes", { p_limite: limite });
  if (pendentes.error)
    throw new ErroGateway(`Falha ao listar cobranças pendentes: ${pendentes.error.message}`);
  for (const p of (pendentes.data ?? []) as FaturaPendente[]) {
    try {
      const cliente = await clienteNoGateway(p);
      const cobranca = await cobrancaNoGateway(p, cliente, hoje);
      const { error } = await supabaseAdmin.rpc("saas_cobranca_vincular_fatura", {
        p_fatura: p.fatura_id,
        p_gateway_id: cobranca.id,
        p_url: cobranca.invoiceUrl ?? "",
        p_boleto_url: cobranca.bankSlipUrl ?? "",
        p_status: cobranca.status ?? "PENDING",
      });
      if (error) throw new ErroGateway(error.message);
      resumo.cobrancasCriadas++;
    } catch (e) {
      // o motivo não leva dado pessoal: mensagens de erro do gateway e do banco falam de campo, não de pessoa
      resumo.falhas.push({
        faturaId: p.fatura_id,
        motivo: e instanceof Error ? e.message.slice(0, 300) : "erro",
      });
    }
  }

  const inad = await supabaseAdmin.rpc("saas_inadimplencia_rodar");
  if (inad.error) throw new ErroGateway(`Falha na inadimplência: ${inad.error.message}`);
  const r = (inad.data ?? {}) as { suspensos?: number; reativados?: number };
  resumo.suspensos = r.suspensos ?? 0;
  resumo.reativados = r.reativados ?? 0;
  return resumo;
}

/** Aplica um evento do webhook na fatura. Devolve o resultado do banco (baixada, estornada, desconhecida...). */
export async function aplicarEvento(p: {
  cobrancaId: string;
  acao: "baixar" | "estornar" | "status";
  valor: number;
  forma: string;
  data: string | null;
  status: string;
}): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc("saas_cobranca_evento", {
    p_gateway_id: p.cobrancaId,
    p_acao: p.acao,
    p_valor: p.valor,
    p_forma: p.forma,
    // sempre enviado (nulo quando o evento não traz data): a função do banco exige os seis parâmetros
    p_data: p.data,
    p_status: p.status,
  } as never);
  if (error) throw new Error(`saas_cobranca_evento: ${error.message}`);
  return data as string;
}
