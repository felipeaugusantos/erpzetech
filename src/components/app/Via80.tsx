import { brl, num } from "@/lib/format";
import { useEmpresaImpressa } from "@/components/app/MarcaEmpresa";

export type Via80Item = {
  descricao: string;
  unidade: string;
  quantidade: number;
  preco: number;
};

export type Via80Dados = {
  /** "Pedido" ou "Orçamento" */
  tipo: string;
  numero: string;
  emitidoEm: string;
  loja: string;
  deposito?: string | null;
  cliente: string;
  obra?: string | null;
  vendedor?: string | null;
  situacao?: string | null;
  validade?: string | null;
  condicao?: string | null;
  prazo?: string | null;
  observacoes?: string | null;
  itens: Via80Item[];
  subtotal: number;
  desconto: number;
  frete: number;
  total: number;
  rodape?: string;
};

/**
 * Via de pedido/orçamento em 80 mm, para a mesma impressora térmica do balcão.
 * Usa o id `cupom-impresso` porque a regra de impressão em styles.css já
 * limita a folha a 80 mm para esse bloco.
 */
export function Via80({ dados }: { dados: Via80Dados }) {
  const linha = "border-t border-dashed border-border my-2";
  const { empresa, logoUrl } = useEmpresaImpressa();
  return (
    <div id="cupom-impresso" className="mx-auto w-full max-w-[320px] bg-card p-3 text-xs">
      <div className="text-center">
        {logoUrl && (
          <img src={logoUrl} alt={dados.loja} className="mx-auto mb-1 h-12 w-auto object-contain" />
        )}
        <p className="font-display text-sm font-bold uppercase">{dados.loja}</p>
        {empresa?.cnpj && <p className="text-muted-foreground">CNPJ {empresa.cnpj}</p>}
        <p className="text-muted-foreground">
          {dados.tipo} — não é documento fiscal
        </p>
      </div>
      <div className={linha} />
      <div className="space-y-0.5">
        <p>
          {dados.tipo} nº <strong>{dados.numero}</strong>
        </p>
        <p>{dados.emitidoEm}</p>
        {dados.situacao && <p>Situação: {dados.situacao}</p>}
        {dados.deposito && <p>Depósito: {dados.deposito}</p>}
        <p>Cliente: {dados.cliente}</p>
        {dados.obra && <p>Obra: {dados.obra}</p>}
        {dados.vendedor && <p>Vendedor: {dados.vendedor}</p>}
        {dados.validade && <p>Validade: {dados.validade}</p>}
        {dados.condicao && <p>Pagamento: {dados.condicao}</p>}
        {dados.prazo && <p>Prazo de entrega: {dados.prazo}</p>}
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
        <div className="flex justify-between">
          <span>Frete</span>
          <span className="text-numeric">{brl(dados.frete)}</span>
        </div>
        <div className="flex justify-between text-sm font-bold">
          <span>TOTAL</span>
          <span className="text-numeric">{brl(dados.total)}</span>
        </div>
      </div>
      {dados.observacoes && (
        <>
          <div className={linha} />
          <p className="whitespace-pre-wrap">{dados.observacoes}</p>
        </>
      )}
      <div className={linha} />
      <p className="text-center text-muted-foreground">
        {dados.rodape ?? "Obrigado pela preferência!"}
      </p>
    </div>
  );
}
