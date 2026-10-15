import { useEffect, useRef } from "react";

/** Chave pública do Turnstile (a do site). Sem ela, o desafio não aparece e o CAPTCHA fica desligado. */
export const CHAVE_TURNSTILE = import.meta.env["VITE_TURNSTILE_SITE_KEY"] as string | undefined;

type ApiTurnstile = {
  render: (
    el: HTMLElement,
    opcoes: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};

declare global {
  interface Window {
    turnstile?: ApiTurnstile;
  }
}

let carregando: Promise<void> | null = null;

function carregarScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  carregando ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      carregando = null;
      reject(new Error("Não foi possível carregar a verificação."));
    };
    document.head.appendChild(s);
  });
  return carregando;
}

/**
 * Desafio do Cloudflare Turnstile. `aoMudar` recebe o token quando a pessoa passa e `null` quando ele expira ou falha.
 * Mude `reiniciar` para pedir um token novo (o token vale para um envio só).
 */
export function Turnstile({
  aoMudar,
  reiniciar,
}: {
  aoMudar: (token: string | null) => void;
  reiniciar: number;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const id = useRef<string | undefined>(undefined);
  const aoMudarRef = useRef(aoMudar);
  aoMudarRef.current = aoMudar;

  useEffect(() => {
    if (!CHAVE_TURNSTILE) return;
    let ativo = true;
    void carregarScript()
      .then(() => {
        if (!ativo || !caixa.current || !window.turnstile) return;
        id.current = window.turnstile.render(caixa.current, {
          sitekey: CHAVE_TURNSTILE,
          callback: (token) => aoMudarRef.current(token),
          "expired-callback": () => aoMudarRef.current(null),
          "error-callback": () => aoMudarRef.current(null),
        });
      })
      .catch(() => aoMudarRef.current(null));
    return () => {
      ativo = false;
      if (id.current) window.turnstile?.remove(id.current);
    };
  }, []);

  useEffect(() => {
    if (reiniciar > 0 && id.current) {
      aoMudarRef.current(null);
      window.turnstile?.reset(id.current);
    }
  }, [reiniciar]);

  if (!CHAVE_TURNSTILE) return null;
  return <div ref={caixa} className="min-h-[65px]" />;
}
