// Login por usuário: o usuário vale dentro da empresa (o mesmo pode existir em empresas diferentes) e o e-mail é só contato.
// Quem já existia continua entrando pelo e-mail. Sem dependência de tela nem de servidor.

export const USUARIO_MINIMO = 3;
export const USUARIO_MAXIMO = 30;

const FORMATO = /^[a-z0-9._-]+$/;

/** Usuário como é guardado: sem espaços nas pontas e em minúsculas. */
export const normalizarUsuario = (s: string) => s.trim().toLowerCase();

/** Mensagem do primeiro problema do usuário (as mesmas regras do banco), ou nulo se está bom. */
export function erroDoUsuario(bruto: string): string | null {
  const u = normalizarUsuario(bruto);
  if (u.length < USUARIO_MINIMO || u.length > USUARIO_MAXIMO)
    return `O usuário precisa ter de ${USUARIO_MINIMO} a ${USUARIO_MAXIMO} caracteres`;
  if (!FORMATO.test(u))
    return "Use só letras minúsculas sem acento, números, ponto, hífen ou sublinhado (sem espaços)";
  return null;
}

/** O que a pessoa digitou no campo de login parece um e-mail (entra pelo caminho antigo) ou é um usuário. */
export const pareceEmail = (s: string) => s.includes("@");

/**
 * Endereço interno do login de quem entra por usuário. O provedor de autenticação exige um e-mail único por conta; este nunca recebe
 * mensagem (domínio reservado .invalid) e não aparece para ninguém. O e-mail de contato fica à parte, no perfil, e pode se repetir.
 */
export function emailInterno(usuario: string, tenantId: string): string {
  return `${normalizarUsuario(usuario)}.${tenantId.replaceAll("-", "")}@usuarios.erpzetech.invalid`;
}

/** Sugestão de usuário a partir de um e-mail (a parte antes do @, limpa), para quem já existe. */
export function usuarioSugerido(email: string): string {
  const base = normalizarUsuario(email.split("@")[0] ?? "")
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, USUARIO_MAXIMO - 4);
  return base.length >= USUARIO_MINIMO ? base : "usuario";
}

const DOMINIO_INTERNO = "@usuarios.erpzetech.invalid";

/** O endereço é o login técnico de quem entra por usuário (não é um e-mail de verdade e não deve aparecer para ninguém). */
export const ehEmailInterno = (email: string | null | undefined) =>
  !!email && email.endsWith(DOMINIO_INTERNO);

/** O que mostrar como identificação da conta: o e-mail de quem entra por e-mail; para quem entra por usuário, o usuário (ou o contato). */
export function contaParaExibir(
  emailDoLogin: string | null | undefined,
  perfil: { usuario?: string | null; email?: string | null } | null | undefined,
): string {
  if (emailDoLogin && !ehEmailInterno(emailDoLogin)) return emailDoLogin;
  return perfil?.usuario ?? perfil?.email ?? "";
}
