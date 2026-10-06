import { brl, num } from "@/lib/format";
import { labelForma } from "@/lib/financeiro";

export type CupomItem = {
  descricao: string;
  unidade: string;
  quantidade: number;
  preco: number;
};

export type CupomDados = {
  numero: string;
  emitidoEm: string;
  loja: string;
  deposito: string;
  cliente: string;
  vendedor: string;
  itens: CupomItem[];
  subtotal: number;
  desconto: number;
  total: number;
  forma: string;
  parcelas?: number;
  recebido?: number;
  troco?: number;
  nfe?: {
    numero: string | null;
    serie: string | null;
    situacao: string;
    chave?: string | null;
  } | null;
  tef?: {
    credenciadora: string;
    nsu: string;
    autorizacao: string;
    bandeira: string;
    simulado?: boolean;
  };
};

/**
 * Cupom de venda em 80 mm, pronto para a impressora térmica do balcão.
 * O bloco só aparece no papel quando `window.print()` é chamado — o resto
 * da tela fica oculto pela regra de impressão em styles.css.
 */
export function CupomFiscal({ dados }: { dados: CupomDados }) {
  const linha = "border-t border-dashed border-border my-2";
  return (
    <div id="cupom-impresso" className="mx-auto w-full max-w-[320px] bg-card p-3 text-xs">
      <div className="text-center">
        <p className="font-display text-sm font-bold uppercase">{dados.loja}</p>
        <p className="text-muted-foreground">Cupom de venda — não é documento fiscal</p>
      </div>
      <div className={linha} />
      <div className="space-y-0.5">
        <p>
          Venda nº <strong>{dados.numero}</strong>
        </p>
        <p>{dados.emitidoEm}</p>
        <p>Depósito: {dados.deposito}</p>
        <p>Cliente: {dados.cliente}</p>
        <p>Vendedor: {dados.vendedor}</p>
      </div>
      <div className={linha} />
      <table className="w-full">
        <tbody>
          {dados.itens.map((i, idx) => (
            <tr key={`${i.descricao}-${idx}`} className="align-top">
              <td className="py-0.5">
                <span className="block">{i.descricao}</span>
                <span className="block text-muted-foreground">
                  {num(i.quantidade, 2)} {i.unidade} × {brl(i.preco)}
                </span>
              </td>
              <td className="py-0.5 text-right text-numeric align-bottom">
                {brl(i.quantidade * i.preco)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={linha} />
      <div className="space-y-0.5">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span className="text-numeric">{brl(dados.subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span>Desconto</span>
          <span className="text-numeric">{brl(dados.desconto)}</span>
        </div>
        <div className="flex justify-between text-sm font-bold">
          <span>TOTAL</span>
          <span className="text-numeric">{brl(dados.total)}</span>
        </div>
        <div className="flex justify-between">
          <span>{labelForma(dados.forma)}</span>
          <span className="text-numeric">
            {dados.parcelas && dados.parcelas > 1 ? `${dados.parcelas}x` : "à vista"}
          </span>
        </div>
        {typeof dados.recebido === "number" && dados.recebido > 0 && (
          <>
            <div className="flex justify-between">
              <span>Recebido</span>
              <span className="text-numeric">{brl(dados.recebido)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Troco</span>
              <span className="text-numeric">{brl(dados.troco ?? 0)}</span>
            </div>
          </>
        )}
      </div>
      {dados.tef && (
        <>
          <div className={linha} />
          <div className="space-y-0.5">
            {dados.tef.simulado && <p className="font-bold">*** TRANSAÇÃO SIMULADA (TESTE) ***</p>}
            <p className="font-semibold">Transação cartão — {dados.tef.credenciadora}</p>
            <p>
              NSU: {dados.tef.nsu || "—"} · Aut.: {dados.tef.autorizacao || "—"}
            </p>
            {dados.tef.bandeira && <p>Bandeira: {dados.tef.bandeira}</p>}
          </div>
        </>
      )}
      {dados.nfe && (
        <>
          <div className={linha} />
          <div className="space-y-0.5">
            <p className="font-semibold">Nota fiscal eletrônica</p>
            <p>
              Nº {dados.nfe.numero ?? "—"} · série {dados.nfe.serie ?? "—"} · {dados.nfe.situacao}
            </p>
            {dados.nfe.chave && <p className="break-all">Chave: {dados.nfe.chave}</p>}
          </div>
        </>
      )}
      <div className={linha} />
      <p className="text-center text-muted-foreground">
        Obrigado pela preferência! Troca em até 7 dias com este cupom.
      </p>
    </div>
  );
}
