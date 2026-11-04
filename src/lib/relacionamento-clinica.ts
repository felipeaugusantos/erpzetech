// Relacionamento com o tutor (clínica): transforma o que a fila de WhatsApp e os contatos registrados provam em contagens
// que não afirmam mais do que a evidência. Regras:
// - "serviço aceitou" (enviada) NÃO é entrega: entrega só existe com a confirmação do WhatsApp (entregue) e leitura com lida;
// - abrir o link do WhatsApp (contato assistido) NÃO é mensagem enviada: o sistema não sabe se a recepção escreveu;
// - nada aqui liga lembrete a retorno: isso exige uma regra de atribuição aprovada pela gestão.
// Só lê; não muda fila, despachante nem contato.

export const LIMITE_LINHAS_PAINEL = 2000;
/** Passado esse tempo "enviando" é sinal de conferência (o banco também marca depois de 5 minutos). */
export const MINUTOS_CONFERIR = 10;

export type LinhaMensagem = {
  tipo: string;
  situacao: string;
  origem: string;
  erro: string | null;
  tentativas: number;
  referencia: string;
  updated_at: string;
};

export type LinhaContato = {
  pet_id: string;
  referencia: string; // AAAA-MM-DD
  canal: "whatsapp" | "telefone" | "outro";
};

/** O que cada situação da fila prova, em linguagem de recepção. */
export const ROTULO_EVIDENCIA: Record<string, string> = {
  na_fila: "Na fila",
  enviando: "Em tentativa",
  enviada: "Serviço aceitou (entrega não confirmada)",
  entregue: "Entrega confirmada",
  lida: "Lida",
  falhou: "Falhou",
  cancelada: "Cancelada",
};

export const rotuloEvidencia = (situacao: string) => ROTULO_EVIDENCIA[situacao] ?? situacao;

export type ResumoMensagens = {
  total: number;
  /** ainda não saiu: na fila (inclui as aguardando nova tentativa) */
  naFila: number;
  /** das na fila, as que já tentaram e esperam repetir */
  aguardandoNovaTentativa: number;
  /** alguma tentativa feita: em tentativa, aceita, entregue, lida, falhou ou esperando repetir */
  tentadas: number;
  /** o serviço aceitou (inclui entregues e lidas) */
  aceitas: number;
  /** o WhatsApp confirmou a entrega (inclui lidas) */
  entregues: number;
  lidas: number;
  falhas: number;
  canceladas: number;
  /** em tentativa há mais de MINUTOS_CONFERIR minutos */
  conferir: number;
  automaticas: number;
  pedidasPelaRecepcao: number;
  motivosDeFalha: { motivo: string; quantidade: number }[];
};

export function resumirMensagens(
  linhas: LinhaMensagem[],
  agora: Date = new Date(),
): ResumoMensagens {
  const r: ResumoMensagens = {
    total: linhas.length,
    naFila: 0,
    aguardandoNovaTentativa: 0,
    tentadas: 0,
    aceitas: 0,
    entregues: 0,
    lidas: 0,
    falhas: 0,
    canceladas: 0,
    conferir: 0,
    automaticas: 0,
    pedidasPelaRecepcao: 0,
    motivosDeFalha: [],
  };
  const motivos = new Map<string, number>();
  const limite = agora.getTime() - MINUTOS_CONFERIR * 60_000;
  for (const l of linhas) {
    if (l.origem === "automatico") r.automaticas++;
    else r.pedidasPelaRecepcao++;
    switch (l.situacao) {
      case "na_fila":
        r.naFila++;
        if (l.tentativas > 0) {
          r.aguardandoNovaTentativa++;
          r.tentadas++;
        }
        break;
      case "enviando":
        r.tentadas++;
        if (new Date(l.updated_at).getTime() <= limite) r.conferir++;
        break;
      case "enviada":
        r.tentadas++;
        r.aceitas++;
        break;
      case "entregue":
        r.tentadas++;
        r.aceitas++;
        r.entregues++;
        break;
      case "lida":
        r.tentadas++;
        r.aceitas++;
        r.entregues++;
        r.lidas++;
        break;
      case "falhou": {
        r.tentadas++;
        r.falhas++;
        const motivo =
          (l.erro ?? "").replace(/\s+/g, " ").trim().slice(0, 140) || "Sem motivo registrado";
        motivos.set(motivo, (motivos.get(motivo) ?? 0) + 1);
        break;
      }
      case "cancelada":
        r.canceladas++;
        break;
    }
  }
  r.motivosDeFalha = [...motivos.entries()]
    .map(([motivo, quantidade]) => ({ motivo, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade || a.motivo.localeCompare(b.motivo))
    .slice(0, 5);
  return r;
}

export type ResumoContatos = {
  /** gravados quando o serviço aceitou a mensagem (o sistema registra sozinho): já contam na fila, não são manuais */
  viaSistema: number;
  /** a recepção abriu o link do WhatsApp: o envio não é confirmado */
  abriuWhatsApp: number;
  /** "Já falei" por telefone ou outro canal: declarado pela recepção */
  declaradoPelaRecepcao: number;
};

/**
 * Separa os contatos de reforço registrados: os que nasceram de uma mensagem aceita pelo serviço (mesma ocasião
 * pet+data com situação enviada, entregue ou lida) vêm do sistema; os demais foram feitos pela recepção.
 */
export function separarContatos(
  contatos: LinhaContato[],
  mensagens: LinhaMensagem[],
): ResumoContatos {
  const aceitas = new Set(
    mensagens
      .filter(
        (m) => m.tipo === "reforco_vacina" && ["enviada", "entregue", "lida"].includes(m.situacao),
      )
      .map((m) => m.referencia.toLowerCase()),
  );
  const r: ResumoContatos = { viaSistema: 0, abriuWhatsApp: 0, declaradoPelaRecepcao: 0 };
  for (const c of contatos) {
    if (aceitas.has(`${c.pet_id}:${c.referencia}`.toLowerCase())) r.viaSistema++;
    else if (c.canal === "whatsapp") r.abriuWhatsApp++;
    else r.declaradoPelaRecepcao++;
  }
  return r;
}

/** Percentual inteiro; sem base devolve null para a tela mostrar "—" em vez de 0%. */
export function percentual(parte: number, base: number): number | null {
  return base > 0 ? Math.round((parte / base) * 100) : null;
}
