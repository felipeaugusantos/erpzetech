import { brl, dateTimeBR, num } from "@/lib/format";

export type NotaEntradaItem = {
  descricao: string;
  codigo: string;
  unidade: string;
  quantidade: number;
  custo: number;
  divergencia?: string | null;
};

export type NotaEntradaDados = {
  numero: string;
  compra: string;
  recebidoEm: string;
  loja: string;
  fornecedor: string;
  documento: string;
  deposito: string;
  condicaoPagamento: string;
  itens: NotaEntradaItem[];
};

/**
 * Nota de entrada da mercadoria recebida (conferência interna, em A4).
 * Só vai ao papel quando `window.print()` é chamado.
 */
export function NotaEntrada({ dados }: { dados: NotaEntradaDados }) {
  const total = dados.itens.reduce((s, i) => s + i.quantidade * i.custo, 0);
  return (
    <div id="nota-impressa" className="mx-auto w-full max-w-[800px] bg-card p-6 text-sm">
      <div className="mb-4 flex items-start justify-between gap-4 border-b border-border pb-3">
        <div>
          <p className="font-display text-lg font-bold uppercase">{dados.loja}</p>
          <p className="text-muted-foreground">Nota de entrada de mercadoria</p>
        </div>
        <div className="text-right">
          <p className="font-semibold">Entrada nº {dados.numero}</p>
          <p className="text-muted-foreground">Compra {dados.compra}</p>
          <p className="text-muted-foreground">{dateTimeBR(dados.recebidoEm)}</p>
        </div>
      </div>

      <div className="mb-4 grid gap-1 sm:grid-cols-2">
        <p>
          <span className="text-muted-foreground">Fornecedor: </span>
          {dados.fornecedor}
        </p>
        <p>
          <span className="text-muted-foreground">Documento / NF: </span>
          {dados.documento || "—"}
        </p>
        <p>
          <span className="text-muted-foreground">Depósito de entrada: </span>
          {dados.deposito}
        </p>
        <p>
          <span className="text-muted-foreground">Pagamento: </span>
          {dados.condicaoPagamento || "—"}
        </p>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-border text-left">
            <th className="py-1">Produto</th>
            <th className="py-1 text-right">Qtde</th>
            <th className="py-1 text-right">Custo</th>
            <th className="py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {dados.itens.map((i, idx) => (
            <tr key={`${i.codigo}-${idx}`} className="border-b border-border/60 align-top">
              <td className="py-1">
                <span className="block font-medium">{i.descricao}</span>
                <span className="block text-xs text-muted-foreground">
                  {i.codigo} {i.unidade ? `· ${i.unidade}` : ""}
                  {i.divergencia ? ` · divergência: ${i.divergencia}` : ""}
                </span>
              </td>
              <td className="py-1 text-right text-numeric">{num(i.quantidade, 3)}</td>
              <td className="py-1 text-right text-numeric">{brl(i.custo)}</td>
              <td className="py-1 text-right text-numeric">{brl(i.quantidade * i.custo)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex justify-end">
        <p className="text-base font-bold">
          Total da entrada: <span className="text-numeric">{brl(total)}</span>
        </p>
      </div>

      <div className="mt-10 grid gap-8 sm:grid-cols-2">
        <p className="border-t border-border pt-1 text-center text-xs text-muted-foreground">
          Conferido por
        </p>
        <p className="border-t border-border pt-1 text-center text-xs text-muted-foreground">
          Responsável pelo estoque
        </p>
      </div>
    </div>
  );
}
