import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/** Páginas do portal exigem conta. Sem sessão, vão para a entrada do portal (e não para o aplicativo da clínica). */
export async function exigirSessaoPortal() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw redirect({ to: "/portal/entrar" });
  return { user: data.user };
}

/** Guarda o código do convite só nesta aba (nunca em localStorage) até o tutor entrar e vincular. */
const CHAVE_CODIGO = "zt-portal-codigo";

export function guardarCodigoDoConvite(codigo: string): void {
  try {
    sessionStorage.setItem(CHAVE_CODIGO, codigo);
  } catch {
    /* sem armazenamento: o tutor digita o código */
  }
}

export function lerCodigoGuardado(): string {
  try {
    return sessionStorage.getItem(CHAVE_CODIGO) ?? "";
  } catch {
    return "";
  }
}

export function esquecerCodigoGuardado(): void {
  try {
    sessionStorage.removeItem(CHAVE_CODIGO);
  } catch {
    /* nada a fazer */
  }
}
