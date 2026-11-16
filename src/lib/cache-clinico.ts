// O cache de consultas é salvo em texto simples no navegador (para as telas abrirem sem internet). Dado clínico (prontuário, vacina, exame,
// tutor e telefone da clínica) nunca entra nele: a cópia local da clínica só virá criptografada, com o trabalho sem internet da clínica.

/** Verdadeiro se a consulta pode ir para o cache salvo no navegador. Toda consulta da clínica tem a chave começando por "clinica-". */
export function consultaPersistivel(chave: readonly unknown[]): boolean {
  const primeira = chave[0];
  if (typeof primeira === "string" && NAO_PERSISTIR.includes(primeira)) return false;
  return !(typeof primeira === "string" && primeira.startsWith("clinica-"));
}

/**
 * Consultas dos portões de acesso (aceite dos termos e situação da assinatura): nunca vão para o cache do navegador, para um
 * "ainda não aceitou" ou "bloqueado" antigo não voltar quando a tela reabrir sem internet.
 */
const NAO_PERSISTIR = ["aceite-legal", "assinatura-situacao", "assinatura-resumo"];
