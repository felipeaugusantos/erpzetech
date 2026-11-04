// Relacionamento com o tutor (clínica): transforma o que a fila de WhatsApp e os contatos registrados provam em contagens
// que não afirmam mais do que a evidência. Regras:
// - "serviço aceitou" (enviada) NÃO é entrega: entrega só existe com a confirmação do WhatsApp (entregue) e leitura com lida;
// - contato assistido é declarado pela recepção ("Já falei"): o sistema não vê a mensagem; abrir o link não grava mais contato;
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
  /** gravados pelo envio do sistema (entrega confirmada; os antigos, na aceitação): já contam na fila, não são manuais */
  viaSistema: number;
  /** "Já falei" pelo WhatsApp, declarado pela recepção (até a mudança de 11/2026, abrir o link já gravava este contato: registros antigos podem ser só link aberto) */
  whatsappDaRecepcao: number;
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
  const r: ResumoContatos = { viaSistema: 0, whatsappDaRecepcao: 0, declaradoPelaRecepcao: 0 };
  for (const c of contatos) {
    if (aceitas.has(`${c.pet_id}:${c.referencia}`.toLowerCase())) r.viaSistema++;
    else if (c.canal === "whatsapp") r.whatsappDaRecepcao++;
    else r.declaradoPelaRecepcao++;
  }
  return r;
}

/** Percentual inteiro; sem base devolve null para a tela mostrar "—" em vez de 0%. */
export function percentual(parte: number, base: number): number | null {
  return base > 0 ? Math.round((parte / base) * 100) : null;
}

/** Quanto tempo uma mensagem só "aceita" pelo serviço segura um novo envio antes de a recepção poder agir de novo. */
export const HORAS_SEM_CONFIRMACAO = 24;

export type EstadoDoAviso = {
  /** texto curto para a linha da lista; null = nada a mostrar */
  rotulo: string | null;
  /** já existe aviso do sistema em andamento ou entregue: enviar de novo duplicaria a mensagem ao tutor */
  bloqueiaNovoEnvio: boolean;
  tom: "neutro" | "alerta";
};

/**
 * O que a lista de reforços mostra para um pet que já tem aviso do sistema. Aceitação do serviço não é entrega: o pet
 * continua na lista até a entrega ser confirmada ou a recepção marcar "Já falei". Passadas HORAS_SEM_CONFIRMACAO sem
 * confirmação, a recepção volta a poder agir (o aviso fica como "sem confirmação").
 */
export function estadoDoAviso(
  situacao: string | undefined,
  enviadaEm: string | null | undefined,
  erro: string | null | undefined,
  agora: Date = new Date(),
): EstadoDoAviso {
  switch (situacao) {
    case "na_fila":
    case "enviando":
      return { rotulo: "Na fila do sistema", bloqueiaNovoEnvio: true, tom: "neutro" };
    case "enviada": {
      const horas = enviadaEm ? (agora.getTime() - new Date(enviadaEm).getTime()) / 3_600_000 : 0;
      return horas >= HORAS_SEM_CONFIRMACAO
        ? {
            rotulo: `Sem confirmação de entrega há mais de ${HORAS_SEM_CONFIRMACAO} h`,
            bloqueiaNovoEnvio: false,
            tom: "alerta",
          }
        : {
            rotulo: "Serviço aceitou: aguardando confirmação de entrega",
            bloqueiaNovoEnvio: true,
            tom: "neutro",
          };
    }
    case "entregue":
    case "lida":
      return { rotulo: "Entrega confirmada", bloqueiaNovoEnvio: true, tom: "neutro" };
    case "falhou":
      return {
        rotulo: erro ? `Falhou: ${erro}` : "Falhou",
        bloqueiaNovoEnvio: false,
        tom: "alerta",
      };
    default:
      return { rotulo: null, bloqueiaNovoEnvio: false, tom: "neutro" };
  }
}
