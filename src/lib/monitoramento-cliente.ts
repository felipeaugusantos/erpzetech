// Monitoramento no navegador: manda os erros não tratados para /api/public/erros (limpos de dados pessoais).
// Nunca atrapalha a tela: qualquer falha ao enviar é engolida, e cada defeito é enviado no máximo uma vez por aba.
import { supabase } from "@/integrations/supabase/client";
import { ehRuido, montarRelato, textoDaImpressao } from "@/lib/monitoramento";

const MAXIMO_POR_ABA = 10;
const enviados = new Set<string>();
let iniciado = false;

export async function relatarErro(error: unknown): Promise<void> {
  try {
    if (typeof window === "undefined" || enviados.size >= MAXIMO_POR_ABA) return;
    const relato = montarRelato(error, {
      origem: "navegador",
      rota: window.location.pathname,
      navegador: navigator.userAgent,
    });
    if (ehRuido(relato.mensagem, relato.stack, navigator.onLine)) return;
    const chave = textoDaImpressao(relato);
    if (enviados.has(chave)) return;
    enviados.add(chave);
    const cabecalhos: Record<string, string> = { "content-type": "application/json" };
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token)
        cabecalhos["authorization"] = `Bearer ${data.session.access_token}`;
    } catch {
      // sem sessão: o erro vai sem a empresa
    }
    await fetch("/api/public/erros", {
      method: "POST",
      headers: cabecalhos,
      body: JSON.stringify(relato),
      keepalive: true,
    });
  } catch {
    // monitorar nunca pode causar erro
  }
}

/** Liga a captura de erros não tratados da página (uma vez). */
export function iniciarMonitoramento(): void {
  if (typeof window === "undefined" || iniciado) return;
  iniciado = true;
  window.addEventListener("error", (e) => {
    // erro de recurso (imagem, script) não vem com .error; mensagem sem objeto só vale se houver texto
    void relatarErro(e.error ?? e.message);
  });
  window.addEventListener("unhandledrejection", (e) => {
    void relatarErro(e.reason);
  });
}
