// Link de acesso da empresa (a tela de login /nome-da-empresa): letras minúsculas, números e hífen, de 3 a 50 caracteres.

/** Digitando: tira acento, põe em minúsculas e troca o resto por hífen. */
export function normalizarSlug(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 50);
}

/** Link pronto para gravar (sem hífen nas pontas); vazio vira nulo. */
export function linkFinal(v: string): string | null {
  return v.replace(/^-+|-+$/g, "") || null;
}

/** Nomes que o sistema usa (rotas e telas): a empresa não pode ter um link igual. */
export const LINKS_RESERVADOS = [
  "auth",
  "api",
  "contato",
  "funcionalidades",
  "boas-vindas",
  "ze-tech",
  "ze-tech-login",
  "dashboard",
  "admin",
  "login",
  "app",
  "www",
  "empresa",
  "assets",
  "static",
];

export function erroDoLink(v: string | null): string | null {
  if (v === null) return null;
  if (!/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$/.test(v))
    return "O link precisa ter de 3 a 50 letras, números ou hífen, sem hífen no começo ou no fim";
  if (LINKS_RESERVADOS.includes(v)) return "Esse link é reservado pelo sistema. Escolha outro.";
  return null;
}
