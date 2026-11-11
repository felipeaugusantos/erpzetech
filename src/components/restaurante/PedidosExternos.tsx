import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCardapio } from "@/hooks/useCardapio";
import { useRealtimeTabelas } from "@/hooks/useRealtimeTabelas";
import { useRelogio } from "@/hooks/useRelogio";
import { brl } from "@/lib/format";
import {
  ROTULO_TIPO_EXTERNO,
  itensSemCorrespondencia,
  totalItensPedido,
  type ItemPedidoExterno,
} from "@/lib/pedido-externo";
import { minutosDesde } from "@/lib/restaurante";
import {
  CHAVE_REST,
  rpcRestaurante,
  tabela,
  type PedidoExternoRegistro,
} from "@/lib/restaurante-dados";

const campo =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/** Caixa de entrada dos pedidos do iFood: a operação aceita (abre o delivery) ou recusa. */
export function PedidosExternos({ onAceito }: { onAceito: (comandaId: string) => void }) {
  const qc = useQueryClient();
  const agora = useRelogio();
  const { data: cardapio } = useCardapio();
  const [mapeando, setMapeando] = useState<PedidoExternoRegistro | null>(null);
  const [recusando, setRecusando] = useState<PedidoExternoRegistro | null>(null);

  useRealtimeTabelas(["restaurante_pedidos_externos"], () =>
    qc.invalidateQueries({ queryKey: [CHAVE_REST, "pedidos-externos"] }),
  );

  const { data: fila = [] } = useQuery({
    queryKey: [CHAVE_REST, "pedidos-externos"],
    queryFn: async () => {
      const r = await tabela("restaurante_pedidos_externos")
        .select("*")
        .eq("situacao", "recebido")
        .order("recebido_em");
      if (r.error) throw new Error(r.error.message);
      return (r.data ?? []) as unknown as PedidoExternoRegistro[];
    },
  });

  const aceitar = useMutation({
    mutationFn: (p: { id: string; mapeamento: Record<string, string> }) =>
      rpcRestaurante<string>("restaurante_externo_aceitar", {
        p_id: p.id,
        p_mapeamento: p.mapeamento,
      }),
    onSuccess: (comandaId) => {
      toast.success("Pedido aceito: o delivery foi aberto");
      setMapeando(null);
      void qc.invalidateQueries({ queryKey: [CHAVE_REST] });
      onAceito(comandaId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function tentarAceitar(p: PedidoExternoRegistro) {
    const faltam = itensSemCorrespondencia(p.pedido, cardapio?.itens ?? []);
    if (faltam.length > 0) setMapeando(p);
    else aceitar.mutate({ id: p.id, mapeamento: {} });
  }

  if (fila.length === 0) return null;

  return (
    <section
      aria-label="Pedidos do iFood aguardando"
      className="mb-4 rounded-xl border-2 border-red-400 bg-red-50 p-3"
    >
      <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-semibold">
        Pedidos do iFood
        <Badge variant="destructive">{fila.length}</Badge>
      </h2>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {fila.map((p) => (
          <article key={p.id} className="space-y-1 rounded-lg border bg-background p-3 text-sm">
            <div className="flex items-center justify-between">
              <strong>#{p.numero_exibicao ?? p.codigo_externo}</strong>
              <span className="text-xs text-muted-foreground">
                há {minutosDesde(p.recebido_em, agora)} min
              </span>
            </div>
            <p>
              {p.pedido.cliente?.nome || "Cliente iFood"} ·{" "}
              {ROTULO_TIPO_EXTERNO[p.pedido.tipo ?? "entrega"]}
            </p>
            <ul className="text-xs text-muted-foreground">
              {p.pedido.itens.map((i, n) => (
                <li key={n}>
                  {i.quantidade}× {i.nome}
                </li>
              ))}
            </ul>
            <p className="font-medium">
              Itens {brl(totalItensPedido(p.pedido))}
              {p.pedido.taxa_entrega ? ` + entrega ${brl(p.pedido.taxa_entrega)}` : ""}
              {p.pedido.pagamento === "pago_online" ? " · já pago" : ""}
            </p>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={() => tentarAceitar(p)} disabled={aceitar.isPending}>
                Aceitar
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRecusando(p)}>
                Recusar
              </Button>
            </div>
          </article>
        ))}
      </div>

      {mapeando && (
        <MapearItens
          pedido={mapeando}
          pendente={aceitar.isPending}
          onFechar={() => setMapeando(null)}
          onConfirmar={(mapeamento) => aceitar.mutate({ id: mapeando.id, mapeamento })}
        />
      )}
      {recusando && <Recusar pedido={recusando} onFechar={() => setRecusando(null)} />}
    </section>
  );
}

function MapearItens({
  pedido,
  pendente,
  onFechar,
  onConfirmar,
}: {
  pedido: PedidoExternoRegistro;
  pendente: boolean;
  onFechar: () => void;
  onConfirmar: (m: Record<string, string>) => void;
}) {
  const { data: cardapio } = useCardapio();
  const faltam: ItemPedidoExterno[] = itensSemCorrespondencia(pedido.pedido, cardapio?.itens ?? []);
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const opcoes = (cardapio?.itens ?? []).filter((i) => !i.venda_por_peso);
  const completo = faltam.every((i) => escolhas[i.codigo]);

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ligar os itens ao seu cardápio</DialogTitle>
          <DialogDescription>
            Escolha o item do cardápio para cada item do iFood abaixo. A escolha fica guardada: nos
            próximos pedidos o item é reconhecido sozinho.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {faltam.map((i) => (
            <div key={i.codigo}>
              <Label htmlFor={`map-${i.codigo}`}>
                {i.nome} <span className="text-xs text-muted-foreground">({brl(i.preco)})</span>
              </Label>
              <select
                id={`map-${i.codigo}`}
                className={campo}
                value={escolhas[i.codigo] ?? ""}
                onChange={(e) => setEscolhas({ ...escolhas, [i.codigo]: e.target.value })}
              >
                <option value="">Escolha o item do cardápio</option>
                {opcoes.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nome}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Voltar
          </Button>
          <Button disabled={!completo || pendente} onClick={() => onConfirmar(escolhas)}>
            Aceitar pedido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Recusar({ pedido, onFechar }: { pedido: PedidoExternoRegistro; onFechar: () => void }) {
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState("");
  const recusar = useMutation({
    mutationFn: () =>
      rpcRestaurante("restaurante_externo_recusar", { p_id: pedido.id, p_motivo: motivo.trim() }),
    onSuccess: () => {
      toast.success("Pedido recusado");
      void qc.invalidateQueries({ queryKey: [CHAVE_REST] });
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Recusar pedido #{pedido.numero_exibicao ?? pedido.codigo_externo}
          </DialogTitle>
          <DialogDescription>Informe o motivo (por exemplo, falta de item).</DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Motivo da recusa"
          value={motivo}
          maxLength={200}
          onChange={(e) => setMotivo(e.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Voltar
          </Button>
          <Button
            variant="destructive"
            disabled={motivo.trim().length < 3 || recusar.isPending}
            onClick={() => recusar.mutate()}
          >
            Recusar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
