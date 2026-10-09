import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bike, MapPin, Phone, Printer } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSessionData } from "@/hooks/useSessionData";
import {
  ROTULO_ETAPA,
  ROTULO_PAGAMENTO,
  etapaDelivery,
  formatarEndereco,
  formatarTelefone,
  htmlPedidoDelivery,
  trocoNecessario,
} from "@/lib/delivery";
import { brl } from "@/lib/format";
import {
  CHAVE_REST,
  rpcRestaurante,
  type Comanda,
  type ComandaItem,
} from "@/lib/restaurante-dados";

/** Dados do pedido de delivery dentro da comanda: endereço, taxa, saída do entregador e impressão. */
export function DeliveryPainel({
  comanda,
  itens,
  total,
  taxaItemId,
}: {
  comanda: Comanda;
  itens: ComandaItem[];
  total: number;
  taxaItemId: string | null;
}) {
  const qc = useQueryClient();
  const { data: sessao } = useSessionData();
  const [entregador, setEntregador] = useState(comanda.entregador ?? "");
  const [taxa, setTaxa] = useState<string | null>(null);

  const comida = itens.filter((i) => i.cardapio_item_id !== taxaItemId);
  const taxaAtual = itens
    .filter((i) => i.cardapio_item_id === taxaItemId && i.situacao !== "cancelado")
    .reduce((s, i) => s + Number(i.total), 0);
  const etapa = etapaDelivery(
    comanda.entrega_situacao,
    comida.map((i) => i.situacao),
  );
  const aberta = comanda.situacao === "aberta";
  const troco = trocoNecessario(total, comanda.entrega_troco_para);
  const jaPagoItens = itens.some((i) => i.pago_em);

  const atualizar = () => void qc.invalidateQueries({ queryKey: [CHAVE_REST] });
  const erro = (e: Error) => toast.error(e.message);

  const avancar = useMutation({
    mutationFn: (p: { para: "aguardando" | "saiu" | "entregue" }) =>
      rpcRestaurante("restaurante_delivery_avancar", {
        p_comanda_id: comanda.id,
        p_situacao: p.para,
        p_entregador: p.para === "saiu" ? entregador.trim() || null : null,
      }),
    onSuccess: atualizar,
    onError: erro,
  });

  const ajustarTaxa = useMutation({
    mutationFn: (valor: number) =>
      rpcRestaurante("restaurante_delivery_taxa", { p_comanda_id: comanda.id, p_taxa: valor }),
    onSuccess: () => {
      setTaxa(null);
      atualizar();
    },
    onError: erro,
  });

  function imprimir() {
    const janela = window.open("", "_blank", "width=420,height=640");
    if (!janela) {
      toast.error("O navegador bloqueou a janela de impressão");
      return;
    }
    janela.document.write(
      htmlPedidoDelivery({
        numero: comanda.numero,
        loja: sessao?.empresa?.nome_fantasia || sessao?.empresa?.razao_social || null,
        cliente: comanda.cliente_nome ?? "Cliente",
        telefone: comanda.entrega_telefone,
        endereco: comanda.entrega_endereco,
        bairro: comanda.entrega_bairro,
        referencia: comanda.entrega_referencia,
        pagamento: comanda.entrega_pagamento,
        trocoPara: comanda.entrega_troco_para,
        observacao: comanda.observacao,
        entregador: comanda.entregador,
        itens: itens
          .filter((i) => i.situacao !== "cancelado")
          .map((i) => ({
            quantidade: Number(i.quantidade),
            nome: i.nome,
            opcoes: i.opcoes.map((o) => o.nome),
            observacao: i.observacao,
            total: Number(i.total),
          })),
        total,
      }),
    );
    janela.document.close();
    janela.focus();
    setTimeout(() => janela.print(), 300);
  }

  return (
    <div className="mb-3 space-y-2 rounded border border-primary/40 bg-primary/5 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-semibold">
          <Bike className="size-4" /> Delivery
          {comanda.canal === "ifood" && <Badge variant="outline">iFood</Badge>}
        </span>
        <Badge>{ROTULO_ETAPA[etapa]}</Badge>
      </div>
      {comanda.entrega_telefone && (
        <p className="flex items-center gap-1.5">
          <Phone className="size-3.5" /> {formatarTelefone(comanda.entrega_telefone)}
        </p>
      )}
      <p className="flex items-start gap-1.5">
        <MapPin className="mt-0.5 size-3.5 shrink-0" />
        {formatarEndereco({
          endereco: comanda.entrega_endereco,
          bairro: comanda.entrega_bairro,
          referencia: comanda.entrega_referencia,
        })}
      </p>
      <p>
        Pagamento: {ROTULO_PAGAMENTO[comanda.entrega_pagamento ?? ""] ?? "a combinar"}
        {troco > 0 && (
          <strong className="ml-1 text-amber-700">
            · levar troco de {brl(troco)} (paga com {brl(comanda.entrega_troco_para ?? 0)})
          </strong>
        )}
      </p>
      {comanda.entregador && <p>Entregador: {comanda.entregador}</p>}

      {aberta && taxa === null && (
        <p className="flex items-center justify-between">
          <span>Taxa de entrega: {brl(taxaAtual)}</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={jaPagoItens || comanda.entrega_situacao === "entregue"}
            onClick={() => setTaxa(String(taxaAtual).replace(".", ","))}
          >
            Ajustar
          </Button>
        </p>
      )}
      {aberta && taxa !== null && (
        <div className="flex items-center gap-2">
          <Input
            aria-label="Taxa de entrega"
            className="h-8 w-24"
            inputMode="decimal"
            value={taxa}
            onChange={(e) => setTaxa(e.target.value)}
          />
          <Button
            size="sm"
            disabled={ajustarTaxa.isPending}
            onClick={() => {
              const v = Number(taxa.replace(",", "."));
              if (!Number.isFinite(v) || v < 0) toast.error("Informe uma taxa válida");
              else ajustarTaxa.mutate(v);
            }}
          >
            Salvar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setTaxa(null)}>
            Cancelar
          </Button>
        </div>
      )}

      {aberta && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {comanda.entrega_situacao === "aguardando" && (
            <>
              <Input
                aria-label="Entregador"
                className="h-8 w-40"
                placeholder="Entregador"
                value={entregador}
                onChange={(e) => setEntregador(e.target.value)}
              />
              <Button
                size="sm"
                disabled={etapa !== "pronto" || avancar.isPending}
                title={etapa !== "pronto" ? "Falta enviar ou preparar itens" : undefined}
                onClick={() => avancar.mutate({ para: "saiu" })}
              >
                Saiu para entrega
              </Button>
            </>
          )}
          {comanda.entrega_situacao === "saiu" && (
            <>
              <Button
                size="sm"
                disabled={avancar.isPending}
                onClick={() => avancar.mutate({ para: "entregue" })}
              >
                Entregue ao cliente
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={avancar.isPending}
                onClick={() => avancar.mutate({ para: "aguardando" })}
              >
                Voltou
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" onClick={imprimir}>
            <Printer className="mr-1 size-4" /> Imprimir pedido
          </Button>
        </div>
      )}
    </div>
  );
}
