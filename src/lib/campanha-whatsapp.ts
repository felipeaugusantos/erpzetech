// Campanha manual de WhatsApp da clínica: no máximo 10 tutores por envio, texto montado pelo veterinário.

export const MAX_CAMPANHA = 10;
export const MAX_TEXTO_CAMPANHA = 1000;
/** Pausa entre uma mensagem e outra, para o número não ser tratado como disparo em massa. */
export const PAUSA_CAMPANHA_MS = 4000;

export type Destinatario = { tutor: string; pets: string[] };

export function primeiroNome(nome: string) {
  return nome.trim().split(/\s+/)[0] ?? "";
}

/** Junta os nomes dos pets: "Thor", "Thor e Mel", "Thor, Mel e Bia". */
export function nomesPets(pets: string[]) {
  const p = pets.map((x) => x.trim()).filter(Boolean);
  if (p.length <= 1) return p[0] ?? "seu pet";
  return `${p.slice(0, -1).join(", ")} e ${p[p.length - 1]}`;
}

export function textoCampanha(modelo: string, d: Destinatario, clinica: string) {
  return modelo
    .replaceAll("{tutor}", primeiroNome(d.tutor))
    .replaceAll("{pet}", nomesPets(d.pets))
    .replaceAll("{clinica}", clinica)
    .trim();
}

/** Limite diário de envios de campanha por empresa (conferido no servidor). */
export const MAX_CAMPANHA_DIA = 50;

export function validarCampanha(modelo: string, quantidade: number): string | null {
  const t = modelo.trim();
  if (t.length < 5) return "Escreva a mensagem da campanha.";
  if (t.length > MAX_TEXTO_CAMPANHA) return `A mensagem passa de ${MAX_TEXTO_CAMPANHA} caracteres.`;
  if (/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|br|io|me|ly|link|app)\b)/i.test(t))
    return "Campanhas não podem conter links.";
  if (quantidade < 1) return "Selecione ao menos um tutor.";
  if (quantidade > MAX_CAMPANHA) return `Selecione no máximo ${MAX_CAMPANHA} tutores por envio.`;
  return null;
}
