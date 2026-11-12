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

export type AtalhoPeriodo = "hoje" | "7d" | "30d" | "mes" | "mes-anterior";

export const ATALHOS_PERIODO: { id: AtalhoPeriodo; rotulo: string }[] = [
  { id: "hoje", rotulo: "Hoje" },
  { id: "7d", rotulo: "7 dias" },
  { id: "30d", rotulo: "30 dias" },
  { id: "mes", rotulo: "Mês atual" },
  { id: "mes-anterior", rotulo: "Mês anterior" },
];

function local(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Datas de um atalho de período, contando o dia de hoje (7 dias = hoje e os 6 anteriores). */
export function periodoDoAtalho(id: AtalhoPeriodo, hoje = new Date()): Periodo {
  const y = hoje.getFullYear();
  const m = hoje.getMonth();
  const d = hoje.getDate();
  switch (id) {
    case "hoje":
      return { de: local(hoje), ate: local(hoje) };
    case "7d":
      return { de: local(new Date(y, m, d - 6)), ate: local(hoje) };
    case "30d":
      return { de: local(new Date(y, m, d - 29)), ate: local(hoje) };
    case "mes":
      return { de: local(new Date(y, m, 1)), ate: local(hoje) };
    case "mes-anterior":
      return { de: local(new Date(y, m - 1, 1)), ate: local(new Date(y, m, 0)) };
  }
}

/** Qual atalho corresponde ao período, ou null quando é personalizado. */
export function atalhoAtivo(p: Periodo, hoje = new Date()): AtalhoPeriodo | null {
  for (const a of ATALHOS_PERIODO) {
    const q = periodoDoAtalho(a.id, hoje);
    if (q.de === p.de && q.ate === p.ate) return a.id;
  }
  return null;
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
