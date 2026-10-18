import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ShoppingCart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR, num } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function DetalhesNotaEntrada({ compraId, onClose }: { compraId: string | null; onClose: () => void }) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["nota-entrada-detalhes", compraId],
    enabled: Boolean(compraId),
    queryFn: async () => {
      if (!compraId) throw new Error("Escolha uma nota importada.");
      const [compra, itens] = await Promise.all([
        supabase.from("compras").select("*, fornecedores(razao_social, cnpj), depositos(nome)").eq("id", compraId).eq("origem", "xml_nfe").single(),
        supabase.from("compra_itens").select("*, produtos(codigo_interno, descricao, unidade, ncm)").eq("compra_id", compraId).order("created_at"),
      ]);
      if (compra.error) throw compra.error;
      if (itens.error) throw itens.error;
      return { compra: compra.data, itens: itens.data ?? [] };
    },
  });

  return (
    <Dialog open={Boolean(compraId)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-5xl grid-cols-[minmax(0,1fr)] overflow-y-auto">
        <DialogHeader className="min-w-0 pr-6 text-left">
          <DialogTitle>Detalhes da nota de entrada{data ? ` · nº ${data.compra.nfe_numero ?? "—"}` : ""}</DialogTitle>
          <DialogDescription>Dados registrados na importação da NF-e.</DialogDescription>
        </DialogHeader>
        {isPending && <p role="status" className="flex items-center gap-2 py-6 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Carregando nota...</p>}
        {isError && <div role="alert" className="space-y-3 py-4"><p className="text-destructive">Não foi possível carregar os detalhes da nota.</p><Button variant="outline" onClick={() => void refetch()}>Tentar novamente</Button></div>}
        {data && <>
          <dl className="grid gap-x-6 gap-y-4 border-b border-border pb-4 text-sm sm:grid-cols-2">
            <Campo label="Fornecedor" value={data.compra.fornecedores?.razao_social} />
            <Campo label="CNPJ / CPF" value={data.compra.fornecedores?.cnpj} />
            <Campo label="Número / série" value={`${data.compra.nfe_numero ?? "—"} / ${data.compra.nfe_serie ?? "—"}`} />
            <Campo label="Emissão" value={data.compra.nfe_emissao ? dateBR(data.compra.nfe_emissao) : null} />
            <Campo label="Compra" value={`nº ${data.compra.numero ?? "—"}`} />
            <Campo label="Situação da compra" value={data.compra.situacao.replaceAll("_", " ")} />
            <Campo label="Depósito de entrada" value={data.compra.depositos?.nome} />
            <Campo label="Condição de pagamento" value={data.compra.condicao_pagamento} />
            <div className="sm:col-span-2"><Campo label="Chave de acesso" value={data.compra.nfe_chave} /></div>
          </dl>
          <div className="min-w-0 overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Produto</TableHead><TableHead>Unidade</TableHead><TableHead className="text-right">Quantidade</TableHead><TableHead className="text-right">Recebida</TableHead><TableHead className="text-right">Custo de aquisição</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.itens.map((item) => <TableRow key={item.id}>
                  <TableCell className="min-w-48"><p className="font-medium">{item.produtos?.descricao ?? "Produto indisponível"}</p><p className="text-xs text-muted-foreground">{item.produtos?.codigo_interno ?? "—"}{item.produtos?.ncm ? ` · NCM ${item.produtos.ncm}` : ""}</p>{(() => { const t = impostosItem(item.impostos); return (item.cfop || t) ? <p className="text-xs text-muted-foreground">{item.cfop ? `CFOP ${item.cfop}` : "CFOP —"}{t ? ` · CST ${t.cst ?? "—"} · ICMS ${brl(t.icms ?? 0)}${t.aliquota_icms ? ` (${num(t.aliquota_icms)}%)` : ""}${t.icms_st ? ` · ST ${brl(t.icms_st)}` : ""} · IPI ${brl(t.ipi ?? 0)} · PIS ${brl(t.pis ?? 0)} · COFINS ${brl(t.cofins ?? 0)}` : ""}</p> : null; })()}{item.observacao && <p className="text-xs text-muted-foreground">{item.observacao}</p>}</TableCell>
                  <TableCell>{item.unidade ?? item.produtos?.unidade ?? "—"}</TableCell>
                  <TableCell className="text-right text-numeric">{num(item.quantidade, 3)}</TableCell>
                  <TableCell className="text-right text-numeric">{num(item.quantidade_recebida, 3)}</TableCell>
                  <TableCell className="text-right text-numeric">{brl(item.custo_unitario)}</TableCell>
                  <TableCell className="text-right text-numeric">{brl(item.total)}</TableCell>
                </TableRow>)}
                {data.itens.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Nenhum item registrado.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
          <dl className="grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm sm:grid-cols-4">
            <Campo label="Subtotal de aquisição" value={brl(data.compra.subtotal)} />
            <Campo label="Frete" value={brl(data.compra.frete)} />
            <Campo label="Desconto" value={brl(data.compra.desconto)} />
            <Campo label="Total da entrada" value={brl(data.compra.total)} />
          </dl>
          {(() => { const t = impostosNota(data.compra.nfe_impostos); return t ? (
            <div className="border-t border-border pt-4">
              <p className="mb-2 text-sm font-semibold">Impostos da nota</p>
              <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <Campo label="Base do ICMS" value={brl(t.base_icms ?? 0)} />
                <Campo label="ICMS" value={brl(t.icms ?? 0)} />
                <Campo label="Base do ICMS-ST" value={brl(t.base_st ?? 0)} />
                <Campo label="ICMS-ST" value={brl(t.icms_st ?? 0)} />
                <Campo label="FCP-ST" value={brl(t.fcp_st ?? 0)} />
                <Campo label="IPI" value={brl(t.ipi ?? 0)} />
                <Campo label="PIS" value={brl(t.pis ?? 0)} />
                <Campo label="COFINS" value={brl(t.cofins ?? 0)} />
                <Campo label="Seguro" value={brl(t.seguro ?? 0)} />
                <Campo label="Outras despesas" value={brl(t.outras ?? 0)} />
                <Campo label="Tributos aproximados" value={brl(t.tributos_aprox ?? 0)} />
                <Campo label="Total da nota" value={t.total_nota != null ? brl(t.total_nota) : null} />
              </dl>
            </div>
          ) : (
            <p className="border-t border-border pt-4 text-sm text-muted-foreground">Os impostos desta nota não foram guardados, porque ela foi importada antes desse recurso.</p>
          ); })()}
          {data.compra.observacoes && <dl className="text-sm"><Campo label="Observações" value={data.compra.observacoes} /></dl>}
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <Button variant="outline" onClick={onClose}>Fechar</Button>
            <Button asChild><Link to="/compras/$id" params={{ id: data.compra.id }}><ShoppingCart className="size-4" /> Abrir compra</Link></Button>
          </div>
        </>}
      </DialogContent>
    </Dialog>
  );
}

function Campo({ label, value }: { label: string; value: string | null | undefined }) {
  return <div className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium [overflow-wrap:anywhere]">{value || "—"}</dd></div>;
}
type Num = number | null | undefined;
type ImpItem = { cst?: string | null; icms?: Num; aliquota_icms?: Num; icms_st?: Num; ipi?: Num; pis?: Num; cofins?: Num };
type ImpNota = { base_icms?: Num; icms?: Num; base_st?: Num; icms_st?: Num; fcp_st?: Num; ipi?: Num; pis?: Num; cofins?: Num; seguro?: Num; outras?: Num; tributos_aprox?: Num; total_nota?: Num };
function ehObjeto(v: unknown): v is Record<string, unknown> { return !!v && typeof v === "object" && !Array.isArray(v); }
function impostosItem(v: unknown): ImpItem | null { return ehObjeto(v) ? (v as ImpItem) : null; }
function impostosNota(v: unknown): ImpNota | null { return ehObjeto(v) ? (v as ImpNota) : null; }
