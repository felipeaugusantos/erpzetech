import type { DadosEtiqueta } from "./etiqueta.ts";
import { ESPECIES, PORTES, rotulo } from "./pet.ts";

/**
 * Ficha de identificação do animal (gaiola, coleira, pertences). A etiqueta fica à vista de quem passa,
 * então leva o mínimo do tutor: nome resumido (primeiro nome e inicial do último) e telefone só se a pessoa ligar a opção ao imprimir.
 * Observações e histórico clínico nunca saem; alergia sai porque é aviso de segurança para quem manuseia o animal.
 */

/** "Maria Aparecida Souza" → "Maria S."; um nome só fica como está. */
export function nomeResumidoDoTutor(nome: string | null | undefined): string | null {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return null;
  if (partes.length === 1) return partes[0]!;
  const ultimo = partes[partes.length - 1]!;
  return `${partes[0]} ${ultimo[0]!.toLocaleUpperCase("pt-BR")}.`;
}

/** "Cão · Shih-tzu · Pequeno" (o que não estiver preenchido fica de fora). */
export function infoDoPet(p: {
  especie?: string | null;
  raca?: string | null;
  porte?: string | null;
}): string | null {
  const partes = [
    rotulo(ESPECIES, p.especie),
    (p.raca ?? "").trim(),
    rotulo(PORTES, p.porte),
  ].filter(Boolean);
  return partes.length > 0 ? partes.join(" · ") : null;
}

const FUSO = "America/Sao_Paulo";

/** Data ou data e hora da retirada, curta: "15/11" ou "15/11 17:30". */
export function previsaoDaFicha(valor: string | null | undefined): string | null {
  const v = (valor ?? "").trim();
  if (!v) return null;
  const dia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (dia) return `${dia[3]}/${dia[2]}`;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: FUSO,
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${partes["day"]}/${partes["month"]} ${partes["hour"]}:${partes["minute"]}`;
}

export type EntradaFichaPet = {
  pet: {
    nome: string;
    especie?: string | null;
    raca?: string | null;
    porte?: string | null;
    alergias?: string | null;
  };
  tutor?: { nome?: string | null; telefone?: string | null } | null;
  os?: {
    numero: number;
    previsao?: string | null;
    servicos?: (string | null | undefined)[];
  } | null;
  copias?: number;
};

export function etiquetaDoPet(e: EntradaFichaPet): DadosEtiqueta {
  const nome = e.pet.nome.trim();
  const servicos = (e.os?.servicos ?? []).map((s) => (s ?? "").trim()).filter(Boolean);
  return {
    descricao: nome,
    copias: e.copias,
    pet: {
      os: e.os?.numero ?? null,
      nome,
      info: infoDoPet(e.pet),
      tutor: nomeResumidoDoTutor(e.tutor?.nome),
      tutorTelefone: (e.tutor?.telefone ?? "").trim() || null,
      servicos: [...new Set(servicos)],
      previsao: previsaoDaFicha(e.os?.previsao),
      alergias: (e.pet.alergias ?? "").trim() || null,
    },
  };
}
