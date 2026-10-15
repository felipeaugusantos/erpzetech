import { createServerFn } from "@tanstack/react-start";

import { MENSAGEM_CAPTCHA } from "./captcha.ts";

type EntradaContato = {
  nome: string;
  email?: string;
  whatsapp?: string;
  plano?: string;
  mensagem?: string;
  /** Campo escondido do formulário (armadilha de robô). */
  site?: string;
  /** Hora em que o formulário abriu. */
  abertoEm?: string;
  /** Token do desafio do Turnstile. */
  captcha?: string;
};

/**
 * Envio do formulário público de contato. Confere o CAPTCHA (se `TURNSTILE_SECRET_KEY` estiver configurada) e só então
 * grava, pela função do banco que valida, limita por origem e por hora. Só este servidor chama a função do banco.
 */
export const enviarContato = createServerFn({ method: "POST" })
  .inputValidator((d: EntradaContato) => {
    const texto = (v: unknown, max: number) =>
      typeof v === "string" ? v.slice(0, max) : undefined;
    return {
      nome: texto(d?.nome, 200) ?? "",
      email: texto(d?.email, 300),
      whatsapp: texto(d?.whatsapp, 60),
      plano: texto(d?.plano, 60),
      mensagem: texto(d?.mensagem, 3000),
      site: texto(d?.site, 300),
      abertoEm: texto(d?.abertoEm, 60),
      captcha: texto(d?.captcha, 4096),
    };
  })
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { ipDoEnvio, verificarTurnstile } = await import("./captcha.ts");
    const ip = ipDoEnvio(getRequest().headers);

    const captcha = await verificarTurnstile(
      data.captcha,
      process.env["TURNSTILE_SECRET_KEY"],
      ip,
      (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(5000) }),
    );
    if (!captcha.ok) throw new Error(MENSAGEM_CAPTCHA[captcha.motivo]);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("contato_enviar", {
      p_nome: data.nome,
      ...(data.email ? { p_email: data.email } : {}),
      ...(data.whatsapp ? { p_whatsapp: data.whatsapp } : {}),
      ...(data.plano ? { p_plano: data.plano } : {}),
      ...(data.mensagem ? { p_mensagem: data.mensagem } : {}),
      ...(data.site ? { p_site: data.site } : {}),
      ...(data.abertoEm ? { p_aberto_em: data.abertoEm } : {}),
      ...(ip ? { p_ip: ip } : {}),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
