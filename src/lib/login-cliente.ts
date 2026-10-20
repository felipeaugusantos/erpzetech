import { supabase } from "@/integrations/supabase/client";
import { entrarPorUsuario, trocarOperadorPorUsuario } from "@/lib/login-usuario.functions";
import { pareceEmail } from "@/lib/usuario-login";

/**
 * Entra com usuário ou e-mail. Com e-mail segue o caminho de sempre (quem já existia); com usuário, o servidor confere a senha dentro da
 * empresa (o link dela) e devolve a sessão. Lança Error com a mensagem para mostrar à pessoa.
 */
export async function entrarComUsuarioOuEmail(campo: string, senha: string, slug: string) {
  if (pareceEmail(campo)) {
    const { error } = await supabase.auth.signInWithPassword({
      email: campo.trim(),
      password: senha,
    });
    if (error) throw new Error(error.message);
    return;
  }
  const sessao = await entrarPorUsuario({ data: { slug, usuario: campo, senha } });
  const { error } = await supabase.auth.setSession(sessao);
  if (error) throw new Error(error.message);
}

/** Troca de operador no caixa: usuário (na empresa de quem já está logado) ou e-mail. */
export async function trocarOperador(campo: string, senha: string) {
  if (pareceEmail(campo)) {
    const { error } = await supabase.auth.signInWithPassword({
      email: campo.trim(),
      password: senha,
    });
    if (error) throw new Error("Usuário ou senha incorretos");
    return;
  }
  const sessao = await trocarOperadorPorUsuario({ data: { usuario: campo, senha } });
  const { error } = await supabase.auth.setSession(sessao);
  if (error) throw new Error("Usuário ou senha incorretos");
}
