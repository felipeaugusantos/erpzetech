import { toast } from "sonner";

/** Abre o HTML numa janela e manda imprimir (mesmo caminho da comanda do restaurante). */
export function imprimirHtml(html: string) {
  const janela = window.open("", "_blank", "width=900,height=700");
  if (!janela) {
    toast.error("O navegador bloqueou a janela de impressão");
    return;
  }
  janela.document.write(html);
  janela.document.close();
  janela.focus();
  setTimeout(() => janela.print(), 300);
}
