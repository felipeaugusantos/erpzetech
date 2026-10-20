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

export function erroDoLink(v: string | null): string | null {
  if (v === null) return null;
  if (!/^[a-z0-9-]{3,50}$/.test(v)) return "O link precisa ter de 3 a 50 letras, números ou hífen";
  return null;
}
