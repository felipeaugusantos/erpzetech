import { toast } from "sonner";

/** Abre o documento numa janela e chama a impressão (romaneio, etiqueta, pedido). */
export function abrirImpressao(html: string, largura = 900, altura = 700) {
  const janela = window.open("", "_blank", `width=${largura},height=${altura}`);
  if (!janela) {
    toast.error("O navegador bloqueou a janela de impressão");
    return;
  }
  janela.document.write(html);
  janela.document.close();
  janela.focus();
  setTimeout(() => janela.print(), 300);
}
