type VinculoCliente = { admin_user_id: string | null; tenant_id: string | null };
type PerfilAdmin = { id: string; tenant_id: string | null };

export function exigirOperadorZeTech(operador: unknown) {
  if (operador !== true) throw new Error("Somente a equipe Ze Tech pode redefinir esta senha");
}

export function validarSenhaAdminCliente(senha: string) {
  if (senha.length < 8) throw new Error("A senha deve ter pelo menos 8 caracteres");
  return senha;
}

export function validarVinculoAdminCliente(
  cliente: VinculoCliente | null,
  perfil: PerfilAdmin | null,
  papeis: { role: string; tenant_id: string | null }[],
) {
  if (!cliente?.admin_user_id || !cliente.tenant_id) {
    throw new Error("Este cliente não possui administrador vinculado");
  }
  if (perfil?.id !== cliente.admin_user_id || perfil?.tenant_id !== cliente.tenant_id) {
    throw new Error("O administrador não pertence à empresa deste cliente");
  }
  if (
    !papeis.some(
      (p) => p.role === "administrador" && (p.tenant_id ?? perfil.tenant_id) === cliente.tenant_id,
    )
  ) {
    throw new Error("O acesso vinculado não possui perfil de administrador nesta empresa");
  }
  return cliente.admin_user_id;
}
