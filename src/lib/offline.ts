import { useEffect, useState } from "react";

/** Indica se o aparelho está com internet (atualiza ao cair e ao voltar). */
export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export type Retrato<T> = { em: string; dados: T };

/** Guarda no próprio computador uma cópia dos dados para consultar sem internet. */
export function salvarRetrato<T>(chave: string, dados: T) {
  try {
    localStorage.setItem(
      `zt-retrato-${chave}`,
      JSON.stringify({ em: new Date().toISOString(), dados }),
    );
  } catch {
    /* sem espaço: segue sem a cópia */
  }
}

export function lerRetrato<T>(chave: string): Retrato<T> | null {
  try {
    const t = localStorage.getItem(`zt-retrato-${chave}`);
    return t ? (JSON.parse(t) as Retrato<T>) : null;
  } catch {
    return null;
  }
}

/** Erro de conexão (não é recusa do banco): a operação deve continuar guardada. */
export function ehErroDeRede(mensagem: string) {
  return /fetch|network|failed|load failed|internet/i.test(mensagem);
}
