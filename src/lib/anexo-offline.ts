// Anexo sem internet: o arquivo escolhido fica cifrado no cofre (loja "arquivo", com o id da operação como nome) e a operação da fila guarda só
// os dados do anexo. Ao reconectar, a operação reserva o caminho no banco, envia o arquivo ao armazenamento e confirma; só então o arquivo
// sai do cofre. Reenviar é seguro em qualquer ponto: a reserva é repetível pela chave, o envio repetido cai na confirmação, e confirmar duas vezes vale uma.
import { novaOperacao, type OperacaoFila } from "./fila-clinica.ts";
import { erroDoArquivo, formatarTamanho, mimeDoArquivo, type CategoriaAnexo } from "./anexos.ts";

export const TIPO_ANEXO_ENVIAR = "anexo_enviar";

/** Quanto de arquivo pode esperar no cofre ao mesmo tempo: o navegador limita o armazenamento e arquivo perdido é exame perdido. */
export const LIMITE_PENDENTE_BYTES = 150 * 1024 * 1024;
/** Mesmo limite do banco por exame ou atendimento. */
export const LIMITE_ANEXOS_POR_ALVO = 20;
/** Folga que o navegador precisa ter além do arquivo (a gravação cifrada e o resto do cofre). */
export const FOLGA_ARMAZENAMENTO_BYTES = 30 * 1024 * 1024;

/** A quem o anexo pertence: um atendimento nascido no notebook ou um exame aberto por uma operação da fila. */
export type AlvoAnexo = { tipo: "atendimento"; id: string } | { tipo: "exame"; abrirOpId: string };

export type PayloadAnexo = {
  /** Os campos que o banco espera em clinica_anexo_offline_preparar. */
  dados: {
    categoria: CategoriaAnexo;
    descricao: string;
    nome_arquivo: string;
    mime: string;
    tamanho: number;
    atendimento_id?: string;
    exame_abrir_chave?: string;
  };
};

const ehAnexo = (op: OperacaoFila) => op.tipo === TIPO_ANEXO_ENVIAR;

export const dadosDoAnexo = (op: OperacaoFila) => (op.payload as PayloadAnexo).dados;

export const chaveDoAlvo = (a: AlvoAnexo) =>
  a.tipo === "atendimento" ? `atendimento:${a.id}` : `exame:${a.abrirOpId}`;

function alvoDaOperacao(op: OperacaoFila): string {
  const d = dadosDoAnexo(op);
  return d.atendimento_id ? `atendimento:${d.atendimento_id}` : `exame:${d.exame_abrir_chave}`;
}

/** Anexos ainda na fila (não enviados) de cada alvo, na ordem em que foram feitos. */
export function anexosPendentesDoAlvo(
  fila: readonly OperacaoFila[],
  alvo: AlvoAnexo,
): OperacaoFila[] {
  const chave = chaveDoAlvo(alvo);
  return fila
    .filter((op) => ehAnexo(op) && alvoDaOperacao(op) === chave)
    .sort((a, b) => a.criadaEm.localeCompare(b.criadaEm));
}

export function bytesPendentes(fila: readonly OperacaoFila[]): number {
  return fila.filter(ehAnexo).reduce((soma, op) => soma + (dadosDoAnexo(op).tamanho || 0), 0);
}

/** Resultado de `navigator.storage.estimate()`. */
export type EstimativaArmazenamento = { quota?: number; usage?: number } | null | undefined;

/** Espaço que o navegador ainda oferece, se ele informa. */
export function espacoLivre(est: EstimativaArmazenamento): number | null {
  if (!est || typeof est.quota !== "number" || typeof est.usage !== "number") return null;
  return Math.max(0, est.quota - est.usage);
}

/** Confere o arquivo escolhido com o formato, o limite do banco, o teto de pendências e o espaço do navegador. */
export function erroDoAnexoLocal(
  arquivo: { name: string; size: number; type: string },
  contexto: {
    fila: readonly OperacaoFila[];
    alvo: AlvoAnexo;
    estimativa?: EstimativaArmazenamento;
  },
): string | null {
  const basico = erroDoArquivo(arquivo);
  if (basico) return basico;
  if (anexosPendentesDoAlvo(contexto.fila, contexto.alvo).length >= LIMITE_ANEXOS_POR_ALVO)
    return `Já há ${LIMITE_ANEXOS_POR_ALVO} anexos esperando envio para este registro: envie-os antes de guardar mais`;
  const pendente = bytesPendentes(contexto.fila);
  if (pendente + arquivo.size > LIMITE_PENDENTE_BYTES)
    return `Os anexos esperando envio passam de ${formatarTamanho(LIMITE_PENDENTE_BYTES)} neste notebook: conecte-se e envie antes de guardar mais`;
  const livre = espacoLivre(contexto.estimativa);
  if (livre !== null && livre < arquivo.size + FOLGA_ARMAZENAMENTO_BYTES)
    return `O navegador não tem espaço para guardar ${formatarTamanho(arquivo.size)} agora: conecte-se e envie os anexos pendentes, ou libere espaço`;
  return null;
}

/** Mensagem amigável para a falha de gravação do navegador por falta de espaço. */
export function mensagemDeGravacao(e: unknown): string {
  const nome = e instanceof Error ? e.name : "";
  if (nome === "QuotaExceededError")
    return "O navegador não tem mais espaço para guardar o arquivo: envie os anexos pendentes ou libere espaço";
  return e instanceof Error ? e.message : String(e);
}

export function operacaoDeAnexo(
  alvo: AlvoAnexo,
  dados: {
    categoria: CategoriaAnexo;
    descricao: string;
    arquivo: { name: string; size: number; type: string };
    /** Operação que ainda precisa sair antes (abertura do atendimento ou do exame). */
    dependeDe?: string[];
  },
  rotuloAlvo: string,
  id?: string,
  agora?: Date,
): OperacaoFila {
  const mime = mimeDoArquivo(dados.arquivo);
  if (!mime) throw new Error("Formato não aceito: envie JPEG, PNG ou PDF");
  const payload: PayloadAnexo = {
    dados: {
      categoria: dados.categoria,
      descricao: dados.descricao.trim(),
      nome_arquivo: dados.arquivo.name,
      mime,
      tamanho: dados.arquivo.size,
      ...(alvo.tipo === "atendimento"
        ? { atendimento_id: alvo.id }
        : { exame_abrir_chave: alvo.abrirOpId }),
    },
  };
  return novaOperacao(
    {
      tipo: TIPO_ANEXO_ENVIAR,
      descricao: `Anexo "${payload.dados.descricao}" (${payload.dados.nome_arquivo}) — ${rotuloAlvo}`,
      payload,
      dependeDe: dados.dependeDe ?? [],
    },
    id,
    agora,
  );
}

/** O que o envio precisa do mundo de fora (banco, armazenamento, cofre): entra por aqui para os testes não dependerem deles. */
export type DependenciasAnexo = {
  preparar(
    chave: string,
    dados: PayloadAnexo["dados"],
  ): Promise<{ anexo_id: string; caminho: string; situacao: string }>;
  /** Devolve a mensagem do erro, ou null se enviou. */
  enviarArquivo(caminho: string, bytes: ArrayBuffer, mime: string): Promise<string | null>;
  /** Devolve a mensagem do erro, ou null se confirmou. */
  confirmar(anexoId: string): Promise<string | null>;
  lerArquivo(chave: string): Promise<ArrayBuffer | undefined>;
  apagarArquivo(chave: string): Promise<void>;
};

/** Anexo que o banco já confirmou antes (por outro envio): vale como enviado. */
const JA_CONFIRMADO = /já foi confirmado/i;

export async function enviarAnexo(
  dep: DependenciasAnexo,
  payload: PayloadAnexo,
  chave: string,
): Promise<void> {
  const reserva = await dep.preparar(chave, payload.dados);
  if (reserva.situacao !== "pendente") {
    // confirmado por um envio anterior cuja resposta se perdeu
    await dep.apagarArquivo(chave);
    return;
  }
  const bytes = await dep.lerArquivo(chave);
  if (!bytes)
    throw new Error(
      "O arquivo deste anexo não está mais no cofre: descarte a operação e anexe de novo",
    );
  const erroEnvio = await dep.enviarArquivo(reserva.caminho, bytes, payload.dados.mime);
  const erroConfirma = await dep.confirmar(reserva.anexo_id);
  // envio falhou mas o arquivo já estava lá (envio anterior com resposta perdida): a confirmação resolve
  if (erroEnvio && erroConfirma) throw new Error(erroEnvio);
  if (erroConfirma && !JA_CONFIRMADO.test(erroConfirma)) throw new Error(erroConfirma);
  await dep.apagarArquivo(chave);
}
