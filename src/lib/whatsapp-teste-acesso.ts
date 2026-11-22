type PapelTeste = "administrador" | "gestor" | "veterinario";

/** Confere os papéis no banco como o usuário autenticado, antes de acessar o serviço de envio. */
export async function exigirAcessoTesteWhatsApp(
  verificar: (papel: PapelTeste) => PromiseLike<{ data: boolean | null; error: unknown }>,
) {
  const papeis: PapelTeste[] = ["administrador", "gestor", "veterinario"];
  const resultados = await Promise.all(papeis.map(verificar));
  if (resultados.some((r) => r.error))
    throw new Error("Não foi possível conferir sua permissão para testar.");
  if (!resultados.some((r) => r.data === true))
    throw new Error("Somente veterinário, administrador ou gestor pode testar.");
}
