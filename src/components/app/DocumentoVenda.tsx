import { brl, num } from "@/lib/format";
import { useEmpresaImpressa } from "@/components/app/MarcaEmpresa";
import { Via80, type Via80Dados } from "@/components/app/Via80";
import { Button } from "@/components/ui/button";

export type FormatoDocumento = "a4" | "meia" | "80mm";

/**
 * Via do orçamento/pedido em folha: A4 em pé ou meia folha na horizontal
 * (A5 deitado). A logo e os dados da loja vêm do cadastro da empresa.
 */
export function DocumentoVenda({
  dados,
  formato,
}: {
  dados: Via80Dados;
  formato: "a4" | "meia";
}) {
  const { empresa, logoUrl } = useEmpresaImpressa();
  const meia = formato === "meia";

  const endereco = [
    [empresa?.endereco, empresa?.numero].filter(Boolean).join(", "),
    empresa?.bairro,
    [empresa?.cidade, empresa?.estado].filter(Boolean).join(" - "),
    empresa?.cep,
  ]
    .filter((p) => p && String(p).trim().length > 0)
    .join(" · ");

  const contato = [empresa?.telefone, empresa?.email]
    .filter((p) => p && String(p).trim().length > 0)
    .join(" · ");

  const pagina = meia
    ? "@page { size: A5 landscape; margin: 8mm; }"
    : "@page { size: A4 portrait; margin: 12mm; }";

  return (
    <>
      <style>{pagina}</style>
      <div
        id="documento-impresso"
        data-formato={formato}
        className={`mx-auto w-full bg-card text-foreground ${
          meia ? "max-w-[820px] p-4 text-[11px]" : "max-w-[760px] p-6 text-xs"
        }`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border pb-3">
          <div className="flex items-start gap-3">
            {logoUrl && (
              <img
                src={logoUrl}
                alt={dados.loja}
                className={meia ? "h-12 w-auto object-contain" : "h-16 w-auto object-contain"}
              />
            )}
            <div>
              <p className={`font-display font-bold uppercase ${meia ? "text-sm" : "text-base"}`}>
                {dados.loja}
              </p>
              {empresa?.cnpj && <p className="text-muted-foreground">CNPJ {empresa.cnpj}</p>}
              {empresa?.inscricao_estadual && (
                <p className="text-muted-foreground">IE {empresa.inscricao_estadual}</p>
              )}
              {endereco && <p className="text-muted-foreground">{endereco}</p>}
              {contato && <p className="text-muted-foreground">{contato}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className={`font-display font-bold uppercase ${meia ? "text-sm" : "text-base"}`}>
              {dados.tipo}
            </p>
            <p className="text-numeric text-lg font-bold">nº {dados.numero}</p>
            <p className="text-muted-foreground">{dados.emitidoEm}</p>
            {dados.situacao && <p className="text-muted-foreground">{dados.situacao}</p>}
          </div>
        </header>

        <section
          className={`mt-3 grid gap-x-6 gap-y-1 ${meia ? "grid-cols-3" : "grid-cols-2"}`}
        >
          <Linha rotulo="Cliente" valor={dados.cliente} />
          {dados.obra && <Linha rotulo="Obra" valor={dados.obra} />}
          {dados.deposito && <Linha rotulo="Depósito" valor={dados.deposito} />}
          {dados.vendedor && <Linha rotulo="Vendedor" valor={dados.vendedor} />}
          {dados.validade && <Linha rotulo="Validade" valor={dados.validade} />}
          {dados.condicao && <Linha rotulo="Pagamento" valor={dados.condicao} />}
          {dados.prazo && <Linha rotulo="Prazo de entrega" valor={dados.prazo} />}
        </section>

        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="border-y border-border bg-muted/50 text-left">
              <th className="p-1.5">Produto</th>
              <th className="p-1.5 text-right">Qtd.</th>
              <th className="p-1.5">Un.</th>
              <th className="p-1.5 text-right">Preço</th>
              <th className="p-1.5 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {dados.itens.map((i, idx) => (
              <tr key={`${i.descricao}-${idx}`} className="border-b border-border/60">
                <td className="p-1.5">{i.descricao}</td>
                <td className="text-numeric p-1.5 text-right">{num(i.quantidade, 3)}</td>
                <td className="p-1.5">{i.unidade}</td>
                <td className="text-numeric p-1.5 text-right">{brl(i.preco)}</td>
                <td className="text-numeric p-1.5 text-right">{brl(i.quantidade * i.preco)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 flex justify-end">
          <div className="w-64 space-y-1">
            <Total rotulo="Subtotal" valor={dados.subtotal} />
            <Total rotulo="Desconto" valor={dados.desconto} />
            <Total rotulo="Frete" valor={dados.frete} />
            <div className="flex justify-between border-t border-border pt-1 text-sm font-bold">
              <span>TOTAL</span>
              <span className="text-numeric">{brl(dados.total)}</span>
            </div>
          </div>
        </div>

        {dados.observacoes && (
          <div className="mt-3 border-t border-border pt-2">
            <p className="font-semibold">Observações</p>
            <p className="whitespace-pre-wrap text-muted-foreground">{dados.observacoes}</p>
          </div>
        )}

        <footer className="mt-4 flex items-end justify-between gap-6 border-t border-dashed border-border pt-3">
          <p className="text-muted-foreground">{dados.rodape ?? "Obrigado pela preferência!"}</p>
          <div className="w-56 border-t border-border pt-1 text-center text-muted-foreground">
            Assinatura do cliente
          </div>
        </footer>
      </div>
    </>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <p>
      <span className="text-muted-foreground">{rotulo}: </span>
      <strong>{valor}</strong>
    </p>
  );
}

function Total({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="text-numeric">{brl(valor)}</span>
    </div>
  );
}

/** Escolha do papel: A4, meia folha horizontal ou 80 mm. */
export function SeletorFormato({
  valor,
  onChange,
}: {
  valor: FormatoDocumento;
  onChange: (f: FormatoDocumento) => void;
}) {
  const opcoes: { valor: FormatoDocumento; label: string }[] = [
    { valor: "a4", label: "A4" },
    { valor: "meia", label: "Meia folha (horizontal)" },
    { valor: "80mm", label: "80 mm" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {opcoes.map((o) => (
        <Button
          key={o.valor}
          type="button"
          size="sm"
          variant={valor === o.valor ? "default" : "outline"}
          onClick={() => onChange(o.valor)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

/** Mostra a via no formato escolhido. */
export function DocumentoOuCupom({
  dados,
  formato,
}: {
  dados: Via80Dados;
  formato: FormatoDocumento;
}) {
  if (formato === "80mm") return <Via80 dados={dados} />;
  return <DocumentoVenda dados={dados} formato={formato} />;
}
