// Contato com o tutor: telefone, link do WhatsApp e mensagem pronta. Sem envio automático.

export type TipoContato = "aniversario" | "retorno";

/** Telefone brasileiro para o WhatsApp (só dígitos, com 55 na frente); null se não der para usar. */
export function telefoneWhatsApp(telefone: string | null | undefined): string | null {
  const d = (telefone ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;
  return null;
}

export function linkWhatsApp(telefone: string | null | undefined, texto: string): string | null {
  const t = telefoneWhatsApp(telefone);
  return t ? `https://wa.me/${t}?text=${encodeURIComponent(texto)}` : null;
}

export const MENSAGEM_PADRAO: Record<TipoContato, string> = {
  aniversario:
    "Oi, {tutor}! Aqui é da {loja}. O {pet} faz aniversário em {data}! 🎉 Que tal um banho de presente para comemorar?",
  retorno:
    "Oi, {tutor}! Aqui é da {loja}. Faz {dias} dias do último banho do {pet}. Quer agendar um horário?",
};

/** Troca {tutor}, {pet}, {loja}, {data} e {dias} pelos valores; o que não tiver valor fica de fora com o texto intacto. */
export function montarMensagem(
  modelo: string,
  v: { tutor?: string; pet?: string; loja?: string; data?: string; dias?: number | string },
) {
  const mapa: Record<string, string | undefined> = {
    tutor: v.tutor ? primeiroNome(v.tutor) : undefined,
    pet: v.pet,
    loja: v.loja,
    data: v.data,
    dias: v.dias !== undefined ? String(v.dias) : undefined,
  };
  return modelo.replace(/\{(tutor|pet|loja|data|dias)\}/g, (m, k: string) => mapa[k] ?? m);
}

export const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;
