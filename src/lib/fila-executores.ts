// Quem envia cada tipo de operação da fila da clínica ao banco. Cada etapa do trabalho sem internet registra aqui os seus tipos
// (cadastro, atendimento, vacina, exame); a chave de repetição da operação vai junto, para a função do banco aceitar o reenvio.
import type { Json } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import {
  TIPO_ATENDIMENTO_FECHAR,
  TIPO_ATENDIMENTO_SALVAR,
  TIPO_VISITA_REGISTRAR,
} from "@/lib/atendimento-offline";
import { TIPO_CADASTRO_RAPIDO } from "@/lib/cadastro-rapido";
import { TIPO_EXAME_ABRIR, TIPO_EXAME_FECHAR, TIPO_EXAME_SALVAR } from "@/lib/exame-offline";
import { TIPO_VACINA_APLICAR, TIPO_VACINA_EXTERNA } from "@/lib/vacina-offline";
import type { OperacaoFila } from "@/lib/fila-clinica";

export type Executor = (payload: unknown, chave: string) => Promise<void>;

async function vacina(acao: "aplicar" | "externa", payload: unknown, chave: string) {
  const { error } = await supabase.rpc("clinica_vacina_offline", {
    p_chave: chave,
    p_acao: acao,
    p_dados: payload as Json,
  });
  if (error) throw error;
}

async function exame(acao: "abrir" | "salvar" | "fechar", payload: unknown, chave: string) {
  const { error } = await supabase.rpc("clinica_exame_offline", {
    p_chave: chave,
    p_acao: acao,
    p_dados: payload as Json,
  });
  if (error) throw error;
}

export const EXECUTORES: Record<string, Executor> = {
  // tutor e pet novos: o banco confere a chave e devolve o mesmo resultado se a operação for reenviada
  [TIPO_CADASTRO_RAPIDO]: async (payload, chave) => {
    const { error } = await supabase.rpc("clinica_cadastro_rapido", {
      p_chave: chave,
      p_dados: payload as Json,
    });
    if (error) throw error;
  },
  // abre o atendimento (consulta marcada ou visita avulsa) com o id e a hora que nasceram no notebook
  [TIPO_VISITA_REGISTRAR]: async (payload, chave) => {
    const { error } = await supabase.rpc("clinica_visita_registrar", {
      p_chave: chave,
      p_dados: payload as Json,
    });
    if (error) throw error;
  },
  [TIPO_ATENDIMENTO_SALVAR]: async (payload, chave) => {
    const p = payload as { atendimento_id: string; dados: Json };
    const { error } = await supabase.rpc("clinica_atendimento_offline", {
      p_chave: chave,
      p_acao: "salvar",
      p_id: p.atendimento_id,
      p_dados: p.dados,
    });
    if (error) throw error;
  },
  [TIPO_ATENDIMENTO_FECHAR]: async (payload, chave) => {
    const p = payload as { atendimento_id: string };
    const { error } = await supabase.rpc("clinica_atendimento_offline", {
      p_chave: chave,
      p_acao: "fechar",
      p_id: p.atendimento_id,
    });
    if (error) throw error;
  },
  // vacina: lote que acabou é recusa do banco e a operação fica guardada para trocar o lote
  [TIPO_VACINA_APLICAR]: (payload, chave) => vacina("aplicar", payload, chave),
  [TIPO_VACINA_EXTERNA]: (payload, chave) => vacina("externa", payload, chave),
  // exame: o id do exame nasce no banco, então salvar e fechar apontam para a chave da abertura
  [TIPO_EXAME_ABRIR]: (payload, chave) => exame("abrir", payload, chave),
  [TIPO_EXAME_SALVAR]: (payload, chave) => exame("salvar", payload, chave),
  [TIPO_EXAME_FECHAR]: (payload, chave) => exame("fechar", payload, chave),
};

export async function enviarOperacao(op: OperacaoFila): Promise<void> {
  const executor = EXECUTORES[op.tipo];
  if (!executor)
    throw new Error(
      `Operação "${op.tipo}" desconhecida neste sistema: atualize a página e tente de novo`,
    );
  await executor(op.payload, op.id);
}
