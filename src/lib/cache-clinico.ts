// O cache de consultas é salvo em texto simples no navegador (para as telas abrirem sem internet). Dado clínico (prontuário, vacina, exame,
// tutor e telefone da clínica) nunca entra nele: a cópia local da clínica só virá criptografada, com o trabalho sem internet da clínica.

/** Verdadeiro se a consulta pode ir para o cache salvo no navegador. Toda consulta da clínica tem a chave começando por "clinica-". */
export function consultaPersistivel(chave: readonly unknown[]): boolean {
  const primeira = chave[0];
  return !(typeof primeira === "string" && primeira.startsWith("clinica-"));
}
