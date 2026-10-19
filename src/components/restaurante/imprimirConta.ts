import { toast } from "sonner";

import { htmlContaComanda, type EntradaContaImpressa, type ItemConta } from "@/lib/conta-comanda";
import type { ComandaItem } from "@/lib/restaurante-dados";

/** Itens que contam na conta: o cancelado não entra. */
export function itensDaConta(itens: ComandaItem[]): ItemConta[] {
  return itens
    .filter((i) => i.situacao !== "cancelado")
    .map((i) => ({
      nome: i.nome,
      quantidade: Number(i.quantidade),
      total: Number(i.total),
      opcoes: i.opcoes.map((o) => o.nome),
    }));
}

/** Abre a conta numa janela de impressão (bobina de 80 mm). */
export function imprimirContaComanda(e: Omit<EntradaContaImpressa, "emitidaEm">) {
  const janela = window.open("", "_blank", "width=420,height=640");
  if (!janela) {
    toast.error("O navegador bloqueou a janela de impressão");
    return;
  }
  janela.document.write(htmlContaComanda({ ...e, emitidaEm: new Date().toLocaleString("pt-BR") }));
  janela.document.close();
  janela.focus();
  setTimeout(() => janela.print(), 300);
}
