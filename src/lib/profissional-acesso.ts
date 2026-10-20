// Acesso do profissional criado junto com o cadastro dele (sem passar por Usuários e perfis). Sem dependência de tela nem de servidor.
import { erroDoUsuario, normalizarUsuario } from "./usuario-login.ts";

/** Perfil dado ao acesso: o veterinário entra no prontuário; os demais, só na própria agenda. */
export const perfilDoProfissional = (funcao: string): "veterinario" | "profissional" =>
  funcao === "veterinario" ? "veterinario" : "profissional";

/** Sugestão de usuário: o primeiro nome, em minúsculas e sem acento. */
export function usuarioSugeridoDoNome(nome: string): string {
  const primeiro = nome.trim().split(/\s+/)[0] ?? "";
  return primeiro
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 30);
}

/** Mensagem do primeiro problema do acesso novo, ou nulo. A senha só precisa ter o mínimo do sistema (8). */
export function erroDoAcessoNovo(usuario: string, senha: string): string | null {
  const erroUsuario = erroDoUsuario(normalizarUsuario(usuario));
  if (erroUsuario) return erroUsuario;
  if (senha.length < 8) return "A senha precisa ter pelo menos 8 caracteres";
  return null;
}
