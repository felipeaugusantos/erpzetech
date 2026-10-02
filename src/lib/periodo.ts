import { useCallback, useEffect, useState } from "react";

const CHAVE = "ze-obra:periodo";
const EVENTO = "ze-obra:periodo-mudou";

export type Periodo = { de: string; ate: string };

export function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function periodoPadrao(): Periodo {
  const hoje = new Date();
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  return { de: iso(inicio), ate: iso(hoje) };
}

function ler(): Periodo {
  if (typeof window === "undefined") return periodoPadrao();
  try {
    const bruto = window.localStorage.getItem(CHAVE);
    if (!bruto) return periodoPadrao();
    const p = JSON.parse(bruto) as Periodo;
    if (!p?.de || !p?.ate) return periodoPadrao();
    return p;
  } catch {
    return periodoPadrao();
  }
}

/** Período de referência compartilhado entre o dashboard e o relatório de lucro. */
export function usePeriodo() {
  const [periodo, setPeriodo] = useState<Periodo>(periodoPadrao);

  useEffect(() => {
    setPeriodo(ler());
    const onChange = () => setPeriodo(ler());
    window.addEventListener(EVENTO, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENTO, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const salvar = useCallback((p: Periodo) => {
    setPeriodo(p);
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CHAVE, JSON.stringify(p));
    window.dispatchEvent(new Event(EVENTO));
  }, []);

  const setDe = useCallback((de: string) => salvar({ ...ler(), de }), [salvar]);
  const setAte = useCallback((ate: string) => salvar({ ...ler(), ate }), [salvar]);

  const mesesDoPeriodo = useCallback((p: Periodo) => {
    const meses: string[] = [];
    const inicio = new Date(`${p.de}T00:00:00`);
    const fim = new Date(`${p.ate}T00:00:00`);
    const cursor = new Date(inicio.getFullYear(), inicio.getMonth(), 1);
    while (cursor <= fim && meses.length < 36) {
      meses.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return meses;
  }, []);

  return { periodo, setPeriodo: salvar, setDe, setAte, mesesDoPeriodo };
}

export function rotuloMes(mes: string) {
  const [ano, m] = mes.split("-");
  const nomes = [
    "jan",
    "fev",
    "mar",
    "abr",
    "mai",
    "jun",
    "jul",
    "ago",
    "set",
    "out",
    "nov",
    "dez",
  ];
  return `${nomes[Number(m) - 1] ?? m}/${String(ano).slice(2)}`;
}
