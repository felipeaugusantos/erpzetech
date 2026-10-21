import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useZonasEntrega } from "@/hooks/useZonasEntrega";
import { supabase } from "@/integrations/supabase/client";
import {
  acharContato,
  zonaDoBairro,
  type ClienteCadastro,
  type PedidoAnterior,
} from "@/lib/delivery-busca";
import { ROTULO_PAGAMENTO, formatarTelefone, soDigitos, telefoneValido } from "@/lib/delivery";
import { CHAVE_REST, rpcRestaurante, tabela } from "@/lib/restaurante-dados";

const numero = (v: string) => Number(v.replace(",", ".")) || 0;

/** Novo pedido de delivery: cliente, endereço, taxa pela zona e forma de pagamento prevista. */
export function NovoDeliveryDialog({
  onFechar,
  onCriado,
}: {
  onFechar: () => void;
  onCriado: (comandaId: string) => void;
}) {
  const qc = useQueryClient();
  const { data: zonas = [] } = useZonasEntrega();
  const [telefone, setTelefone] = useState("");
  const [cliente, setCliente] = useState("");
  const [endereco, setEndereco] = useState("");
  const [bairro, setBairro] = useState("");
  const [referencia, setReferencia] = useState("");
  const [taxa, setTaxa] = useState("0");
  const [zonaId, setZonaId] = useState("");
  const [pagamento, setPagamento] = useState("dinheiro");
  const [troco, setTroco] = useState("");
  const [observacao, setObservacao] = useState("");

  // o telefone traz nome e endereço: do último pedido de delivery com esse número ou, se nunca pediu, do cadastro de clientes (só onde o campo
  // estiver vazio). Vale com ou sem DDD e com ou sem o 55.
  const ultimaBusca = useRef("");
  // o telefone mais recente do campo e o que a busca anterior preencheu sozinha (para trocar pelo do número corrigido, sem tocar no que o operador digitou)
  const telefoneAtual = useRef(telefone);
  telefoneAtual.current = telefone;
  const preenchido = useRef({ cliente: "", endereco: "", bairro: "", referencia: "" });
  async function buscarPeloTelefone() {
    const d = soDigitos(telefone);
    if (d.length < 8 || ultimaBusca.current === d) return;
    ultimaBusca.current = d;
    const { data: pedidosBrutos } = await tabela("comandas")
      .select(
        "cliente_nome, entrega_telefone, entrega_endereco, entrega_bairro, entrega_referencia",
      )
      .eq("tipo", "delivery")
      .not("entrega_telefone", "is", null)
      .order("aberta_em", { ascending: false })
      .limit(500);
    const pedidos = (pedidosBrutos ?? []) as unknown as PedidoAnterior[];
    let clientes: ClienteCadastro[] = [];
    // quem atende o delivery pode não ler o cadastro de clientes: sem permissão, só os pedidos anteriores valem
    try {
      clientes = await qc.fetchQuery({
        queryKey: [CHAVE_REST, "clientes-do-delivery"],
        staleTime: 5 * 60_000,
        queryFn: async () => {
          const { data, error } = await supabase
            .from("clientes")
            .select("nome, telefone, whatsapp, endereco, numero, bairro")
            .is("deleted_at", null)
            .limit(5000);
          if (error) throw error;
          return (data ?? []) as ClienteCadastro[];
        },
      });
    } catch {
      clientes = [];
    }
    // o operador pode ter corrigido o número enquanto a busca andava: resultado de número que não está mais no campo é descartado
    if (soDigitos(telefoneAtual.current) !== d) return;
    const c = acharContato(telefone, pedidos, clientes);
    if (!c) return;
    const antes = preenchido.current;
    // preenche o que está vazio e troca o que a busca anterior preencheu (de outro número); o que o operador digitou fica
    const troca = (v: string, anterior: string, novo: string) => (!v || v === anterior ? novo : v);
    setCliente((v) => troca(v, antes.cliente, c.nome));
    setEndereco((v) => troca(v, antes.endereco, c.endereco));
    setBairro((v) => troca(v, antes.bairro, c.bairro));
    setReferencia((v) => troca(v, antes.referencia, c.referencia));
    preenchido.current = {
      cliente: c.nome,
      endereco: c.endereco,
      bairro: c.bairro,
      referencia: c.referencia,
    };
    toast.info(
      c.origem === "pedido"
        ? "Dados do último pedido deste telefone preenchidos"
        : "Dados do cadastro de clientes preenchidos",
    );
  }

  // telefone completo (DDD e número): busca sozinho, sem esperar sair do campo
  useEffect(() => {
    const d = soDigitos(telefone);
    if (d.length < 8) ultimaBusca.current = "";
    if (d.length < 10) return;
    const t = setTimeout(() => void buscarPeloTelefone(), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telefone]);

  // bairro que bate com uma zona cadastrada escolhe a zona e a taxa (se a zona e a taxa ainda não foram definidas)
  useEffect(() => {
    if (zonaId || numero(taxa) > 0) return;
    const z = zonaDoBairro(bairro, zonas);
    if (z) {
      setZonaId(z.id);
      setTaxa(String(z.taxa).replace(".", ","));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bairro, zonas]);

  function escolherZona(id: string) {
    const z = zonas.find((x) => x.id === id);
    if (!z) return;
    setZonaId(z.id);
    setBairro(z.nome);
    setTaxa(String(z.taxa).replace(".", ","));
  }

  const criar = useMutation({
    mutationFn: async () => {
      if (!telefoneValido(telefone)) throw new Error("Telefone inválido");
      return rpcRestaurante<string>("restaurante_abrir_delivery", {
        p_cliente: cliente,
        p_telefone: soDigitos(telefone) || null,
        p_endereco: endereco,
        p_bairro: bairro.trim() || null,
        p_referencia: referencia.trim() || null,
        p_taxa: numero(taxa),
        p_pagamento: pagamento || null,
        p_troco_para: pagamento === "dinheiro" && troco.trim() ? numero(troco) : null,
        p_observacao: observacao.trim() || null,
      });
    },
    onSuccess: (id) => {
      toast.success("Pedido de delivery aberto");
      void qc.invalidateQueries({ queryKey: [CHAVE_REST] });
      onCriado(id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo pedido de delivery</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="dl-tel">Telefone</Label>
            <Input
              mascara="telefone"
              id="dl-tel"
              inputMode="tel"
              autoFocus
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              onBlur={() => {
                setTelefone((t) => formatarTelefone(t));
                void buscarPeloTelefone();
              }}
            />
          </div>
          <div>
            <Label htmlFor="dl-nome">Nome do cliente</Label>
            <Input id="dl-nome" value={cliente} onChange={(e) => setCliente(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="dl-end">Endereço (rua e número)</Label>
            <Input id="dl-end" value={endereco} onChange={(e) => setEndereco(e.target.value)} />
          </div>
          {zonas.some((z) => z.ativo) && (
            <div>
              <Label>Zona de entrega</Label>
              <Select value={zonaId} onValueChange={escolherZona}>
                <SelectTrigger aria-label="Zona de entrega">
                  <SelectValue placeholder="Escolha para preencher a taxa" />
                </SelectTrigger>
                <SelectContent>
                  {zonas
                    .filter((z) => z.ativo)
                    .map((z) => (
                      <SelectItem key={z.id} value={z.id}>
                        {z.nome} · R$ {String(z.taxa).replace(".", ",")}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="dl-bairro">Bairro</Label>
            <Input id="dl-bairro" value={bairro} onChange={(e) => setBairro(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="dl-taxa">Taxa de entrega (R$)</Label>
            <Input
              id="dl-taxa"
              inputMode="decimal"
              value={taxa}
              onChange={(e) => setTaxa(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="dl-ref">Ponto de referência</Label>
            <Input id="dl-ref" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
          </div>
          <div>
            <Label>Pagamento</Label>
            <Select value={pagamento} onValueChange={setPagamento}>
              <SelectTrigger aria-label="Forma de pagamento prevista">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ROTULO_PAGAMENTO).map(([valor, rotulo]) => (
                  <SelectItem key={valor} value={valor}>
                    {rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {pagamento === "dinheiro" && (
            <div>
              <Label htmlFor="dl-troco">Troco para (R$)</Label>
              <Input
                id="dl-troco"
                inputMode="decimal"
                placeholder="se precisar"
                value={troco}
                onChange={(e) => setTroco(e.target.value)}
              />
            </div>
          )}
          <div className="sm:col-span-2">
            <Label htmlFor="dl-obs">Observação do pedido</Label>
            <Textarea
              id="dl-obs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => criar.mutate()} disabled={criar.isPending}>
            Abrir e lançar os itens
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
