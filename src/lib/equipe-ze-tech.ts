import { z } from "zod";

// Stable ID of the existing owner; never resolve authorization from a mutable email.
export const ADMIN_EQUIPE_ZE_TECH = "458b7232-b5be-4f67-a3f8-3979db96088a";

export function exigirAdminEquipe(userId: string, operador: unknown) {
  if (userId !== ADMIN_EQUIPE_ZE_TECH || operador !== true)
    throw new Error("Somente o administrador da Ze Tech gerencia a equipe.");
}

export function validarRemocaoEquipe(userId: string) {
  if (userId === ADMIN_EQUIPE_ZE_TECH)
    throw new Error("O acesso do administrador principal não pode ser removido.");
}

export const cadastroEquipe = z
  .object({
    nome: z.string().trim().min(2, "Informe o nome.").max(120),
    email: z.string().trim().toLowerCase().email("E-mail inválido."),
    modo: z.enum(["novo", "existente"]),
    senha: z.string().max(128),
  })
  .superRefine((v, ctx) => {
    if (v.modo === "novo" && v.senha.length < 12)
      ctx.addIssue({
        code: "custom",
        path: ["senha"],
        message: "Use uma senha com pelo menos 12 caracteres.",
      });
  });
