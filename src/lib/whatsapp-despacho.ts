// Regras do envio automático de WhatsApp, sem banco nem rede: texto final, espera entre tentativas e ritmo de envio.
import { dateBR } from "./format.ts";
import {
  MENSAGEM_LAVA_PADRAO,
  formatarIdentificacao,
  montarMensagemLava,
  type TipoAviso,
} from "./lava-rapido.ts";
import { ErroEvolution } from "./whatsapp-evolution.ts";

export const RODAPE_SAIR = "\n\nPara não receber mais avisos, responda SAIR.";

/** Espera (em minutos) antes de cada nova tentativa: o envio é tentado até 4 vezes no total. */
export const ESPERA_TENTATIVAS_MIN = [2, 10, 30] as const;

/** Texto enviado ao cliente: o modelo da empresa (ou o padrão), com as variáveis e o aviso de como sair. */
export function textoDoAviso(
  tipo: TipoAviso,
  variaveis: Parameters<typeof montarMensagemLava>[1],
  modelo?: string | null,
) {
  const base = modelo && modelo.trim() ? modelo : MENSAGEM_LAVA_PADRAO[tipo];
  return montarMensagemLava(base, variaveis).trim() + RODAPE_SAIR;
}

/** Quando tentar de novo depois da falha número `tentativa` (1, 2, …). null = esgotou, a mensagem fica como falha. */
export function proximaTentativaEm(tentativa: number, agora: Date = new Date()): Date | null {
  const min = ESPERA_TENTATIVAS_MIN[tentativa - 1];
  return min === undefined ? null : new Date(agora.getTime() + min * 60_000);
}

/** Tempo de "digitando…" antes do envio, entre 1,5 e 4 segundos, para o envio não sair em rajada. */
export function atrasoDeEnvio(aleatorio: () => number = Math.random) {
  return Math.round(1500 + aleatorio() * 2500);
}

/** Item reservado pelo banco (wa_reservar) para ser enviado agora. */
export type ItemReservado = {
  id: string;
  tenant_id: string;
  instancia: string;
  numero: string;
  tipo: TipoAviso;
  tentativas: number;
  modelo: string | null;
  loja: string | null;
  variaveis: Record<string, unknown>;
};

/** Texto final de um item reservado: modelo da empresa (ou padrão) com os dados guardados na fila. */
export function textoDoItem(item: ItemReservado) {
  const v = item.variaveis;
  const texto = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : undefined);
  const numero = (k: string) => (typeof v[k] === "number" ? (v[k] as number) : undefined);
  const identificacao = texto("veiculo");
  const data = texto("data");
  const plano = texto("plano");
  const restam = numero("restam");
  const dias = numero("dias");
  const cliente = texto("cliente");
  return textoDoAviso(
    item.tipo,
    {
      ...(cliente ? { cliente } : {}),
      ...(identificacao
        ? { veiculo: formatarIdentificacao(texto("tipo_veiculo") ?? "carro", identificacao) }
        : {}),
      ...(item.loja ? { loja: item.loja } : {}),
      ...(data ? { data: dateBR(data) } : {}),
      ...(plano ? { plano } : {}),
      ...(restam !== undefined ? { restam } : {}),
      ...(dias !== undefined ? { dias } : {}),
    },
    item.modelo,
  );
}

/** Falha que vale tentar de novo: rede fora do ar, tempo esgotado ou erro do próprio servidor. */
export function falhaRepetivel(e: unknown) {
  return e instanceof ErroEvolution ? e.rede || e.status >= 500 || e.status === 429 : true;
}

export type DepsDespacho = {
  varrer: () => Promise<number>;
  reservar: (total: number, porEmpresa: number, dentroHorario: boolean) => Promise<ItemReservado[]>;
  enviar: (
    item: ItemReservado,
    texto: string,
    atrasoMs: number,
  ) => Promise<{ idMensagem: string; jid: string | null }>;
  resultado: (r: {
    id: string;
    ok: boolean;
    idExterno?: string;
    jid?: string | null;
    erro?: string;
    proxima?: Date | null;
  }) => Promise<void>;
  agora?: () => Date;
  aleatorio?: () => number;
  pausa?: (ms: number) => Promise<void>;
};

export type RelatorioDespacho = {
  enfileiradas: number;
  enviadas: number;
  repetir: number;
  falhas: number;
  /** enviadas pelo WhatsApp, mas sem o resultado gravado: o banco as marca para conferência */
  semRegistro: number;
};

/** Uma rodada do envio: enfileira o automático, reserva o que é da hora e envia um a um, com pausa entre mensagens. */
export async function despachar(deps: DepsDespacho): Promise<RelatorioDespacho> {
  const agora = deps.agora ?? (() => new Date());
  const aleatorio = deps.aleatorio ?? Math.random;
  const pausa = deps.pausa ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rel: RelatorioDespacho = {
    enfileiradas: 0,
    enviadas: 0,
    repetir: 0,
    falhas: 0,
    semRegistro: 0,
  };
  rel.enfileiradas = await deps.varrer();
  const itens = await deps.reservar(20, 2, dentroDoHorario(agora()));
  let primeiro = true;
  for (const item of itens) {
    // pausa entre uma mensagem e outra, para não sair em rajada
    if (!primeiro) await pausa(1000 + Math.round(aleatorio() * 2000));
    primeiro = false;
    let enviado: { idMensagem: string; jid: string | null };
    try {
      enviado = await deps.enviar(item, textoDoItem(item), atrasoDeEnvio(aleatorio));
    } catch (e) {
      const erro = e instanceof Error ? e.message : "Falha no envio";
      const proxima = falhaRepetivel(e) ? proximaTentativaEm(item.tentativas, agora()) : null;
      await deps.resultado({ id: item.id, ok: false, erro, proxima });
      if (proxima) rel.repetir++;
      else rel.falhas++;
      continue;
    }
    // já saiu pelo WhatsApp: se não der para gravar, nunca volta para a fila (duplicaria a mensagem).
    // Fica "enviando" e o banco a marca para conferência depois de 5 minutos.
    rel.enviadas++;
    let gravado = false;
    for (let i = 0; i < 3 && !gravado; i++) {
      try {
        await deps.resultado({
          id: item.id,
          ok: true,
          idExterno: enviado.idMensagem,
          jid: enviado.jid,
        });
        gravado = true;
      } catch {
        if (i < 2) await pausa(500);
      }
    }
    if (!gravado) rel.semRegistro++;
  }
  return rel;
}

/** Dentro do horário comercial de envio (8h às 20h, horário de Brasília)? Avisos fora dele esperam. */
export function dentroDoHorario(agora: Date = new Date()) {
  const h = (agora.getUTCHours() + 24 - 3) % 24;
  return h >= 8 && h < 20;
}

const ROTULOS_SITUACAO: Record<string, string> = {
  na_fila: "Na fila",
  enviando: "Enviando…",
  enviada: "Enviada",
  entregue: "Entregue",
  lida: "Lida",
  falhou: "Falhou",
  cancelada: "Cancelada",
};

export const rotuloSituacao = (situacao: string) => ROTULOS_SITUACAO[situacao] ?? situacao;
