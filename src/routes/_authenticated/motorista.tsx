import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Eraser, MapPin, Package, Play, Truck, XCircle } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { dateBR, num } from "@/lib/format";
import { corEntrega, enderecoPedido, labelEntrega, motivosInsucesso } from "@/lib/entrega";
import { PageHeader, EmptyState } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/motorista")({
  head: () => ({
    meta: [
      { title: "Minhas entregas — Ze Obra" },
      {
        name: "description",
        content: "Tela do motorista: rota do dia, confirmação de entrega com foto e assinatura.",
      },
      { property: "og:title", content: "Minhas entregas — Ze Obra" },
      {
        property: "og:description",
        content: "O motorista confirma a entrega, quem recebeu e registra insucessos.",
      },
    ],
  }),
  component: AppMotorista,
});

type EntregaItem = {
  id: string;
  quantidade: number;
  produtos: { descricao: string; codigo_interno: string } | null;
};

function Assinatura({
  onChange,
}: {
  onChange: (dataUrl: string | null) => void;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const desenhando = useRef(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#003D1A";
  }, []);

  const ponto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = ref.current!;
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * canvas.width,
      y: ((e.clientY - r.top) / r.height) * canvas.height,
    };
  };

  return (
    <div>
      <canvas
        ref={ref}
        width={600}
        height={200}
        className="h-36 w-full touch-none rounded-md border border-border bg-card"
        onPointerDown={(e) => {
          const ctx = ref.current?.getContext("2d");
          if (!ctx) return;
          desenhando.current = true;
          const p = ponto(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!desenhando.current) return;
          const ctx = ref.current?.getContext("2d");
          if (!ctx) return;
          const p = ponto(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          desenhando.current = false;
          onChange(ref.current?.toDataURL("image/png") ?? null);
        }}
        onPointerLeave={() => {
          if (desenhando.current) {
            desenhando.current = false;
            onChange(ref.current?.toDataURL("image/png") ?? null);
          }
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-1"
        onClick={() => {
          const canvas = ref.current;
          const ctx = canvas?.getContext("2d");
          if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
          onChange(null);
        }}
      >
        <Eraser className="size-4" /> Limpar assinatura
      </Button>
    </div>
  );
}

function AppMotorista() {
  const queryClient = useQueryClient();
  const [motoristaId, setMotoristaId] = useState("");
  const [entregaId, setEntregaId] = useState<string | null>(null);
  const [insucessoId, setInsucessoId] = useState<string | null>(null);
  const [recebedor, setRecebedor] = useState("");
  const [documento, setDocumento] = useState("");
  const [observacao, setObservacao] = useState("");
  const [assinatura, setAssinatura] = useState<string | null>(null);
  const [foto, setFoto] = useState<File | null>(null);
  const [qtds, setQtds] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState<string>(motivosInsucesso[0]);
  const [motivoObs, setMotivoObs] = useState("");

  const { data: motoristas = [] } = useQuery({
    queryKey: ["motoristas-ativos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("motoristas")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!motoristaId && motoristas[0]) setMotoristaId(motoristas[0].id);
  }, [motoristas, motoristaId]);

  const { data: entregas = [], isLoading } = useQuery({
    queryKey: ["entregas-motorista", motoristaId],
    enabled: Boolean(motoristaId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entregas")
        .select(
          "*, veiculos(placa, descricao), pedidos(numero, observacoes, entrega_endereco, entrega_numero, entrega_bairro, entrega_cidade, entrega_estado, clientes(nome, telefone)), entrega_itens(id, quantidade, produtos(descricao, codigo_interno))",
        )
        .eq("motorista_id", motoristaId)
        .in("situacao", ["planejada", "em_rota"])
        .order("sequencia", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data;
    },
  });

  const entregaAtual = useMemo(
    () => entregas.find((e) => e.id === entregaId) ?? null,
    [entregas, entregaId],
  );
  const itensAtuais = (entregaAtual?.entrega_itens ?? []) as unknown as EntregaItem[];

  const iniciar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("entrega_iniciar_rota", { p_entrega_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Boa viagem! Entrega em rota.");
      void queryClient.invalidateQueries({ queryKey: ["entregas-motorista"] });
      void queryClient.invalidateQueries({ queryKey: ["entregas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const concluir = useMutation({
    mutationFn: async () => {
      if (!entregaAtual) return;
      if (!recebedor.trim()) throw new Error("Informe quem recebeu a entrega");

      let fotoUrl: string | null = null;
      if (foto) {
        const nome = `${entregaAtual.tenant_id}/${entregaAtual.id}-${Date.now()}.jpg`;
        const up = await supabase.storage.from("entregas").upload(nome, foto, {
          contentType: foto.type || "image/jpeg",
        });
        if (up.error) throw up.error;
        fotoUrl = up.data.path;
      }

      const itens = itensAtuais.map((i) => ({
        entrega_item_id: i.id,
        quantidade: Number(qtds[i.id] ?? i.quantidade),
      }));

      const { error } = await supabase.rpc("entrega_concluir", {
        p_entrega_id: entregaAtual.id,
        p_recebedor: recebedor.trim(),
        p_itens: itens,
        ...(documento ? { p_documento: documento } : {}),
        ...(assinatura ? { p_assinatura: assinatura } : {}),
        ...(fotoUrl ? { p_foto_url: fotoUrl } : {}),
        ...(observacao ? { p_observacao: observacao } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Entrega confirmada.");
      setEntregaId(null);
      setRecebedor("");
      setDocumento("");
      setObservacao("");
      setAssinatura(null);
      setFoto(null);
      setQtds({});
      void queryClient.invalidateQueries({ queryKey: ["entregas-motorista"] });
      void queryClient.invalidateQueries({ queryKey: ["entregas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const registrarInsucesso = useMutation({
    mutationFn: async () => {
      if (!insucessoId) return;
      const { error } = await supabase.rpc("entrega_insucesso", {
        p_entrega_id: insucessoId,
        p_motivo: motivo,
        ...(motivoObs ? { p_observacao: motivoObs } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Insucesso registrado.");
      setInsucessoId(null);
      setMotivoObs("");
      void queryClient.invalidateQueries({ queryKey: ["entregas-motorista"] });
      void queryClient.invalidateQueries({ queryKey: ["entregas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title="Minhas entregas"
        description="Rota do dia na palma da mão: confirme quem recebeu, tire a foto e colha a assinatura."
      />

      <div className="panel mb-4 p-3">
        <Label>Motorista</Label>
        <Select value={motoristaId} onValueChange={setMotoristaId}>
          <SelectTrigger>
            <SelectValue placeholder="Escolha o motorista" />
          </SelectTrigger>
          <SelectContent>
            {motoristas.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : entregas.length === 0 ? (
        <EmptyState
          title="Nenhuma entrega na sua rota."
          description="Quando a loja planejar uma entrega para você, ela aparece aqui."
        />
      ) : (
        <div className="grid gap-3">
          {entregas.map((e) => {
            const pedido = e.pedidos as unknown as
              | {
                  numero: number;
                  observacoes: string | null;
                  entrega_endereco: string | null;
                  entrega_numero: string | null;
                  entrega_bairro: string | null;
                  entrega_cidade: string | null;
                  entrega_estado: string | null;
                  clientes: { nome: string; telefone: string | null } | null;
                }
              | null;
            const veiculo = e.veiculos as unknown as { placa: string; descricao: string } | null;
            const itens = (e.entrega_itens ?? []) as unknown as EntregaItem[];
            return (
              <div key={e.id} className="panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-display text-base font-semibold">
                      {pedido?.clientes?.nome ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground text-numeric">
                      Entrega #{String(e.numero).padStart(4, "0")} · Pedido #
                      {String(pedido?.numero ?? "").padStart(4, "0")}
                      {e.sequencia ? ` · ${e.sequencia}ª parada` : ""}
                    </p>
                  </div>
                  <Badge className={corEntrega(e.situacao)}>{labelEntrega(e.situacao)}</Badge>
                </div>

                <p className="mt-3 flex items-start gap-2 text-sm">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
                  {pedido ? enderecoPedido(pedido) : "—"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {veiculo ? `${veiculo.descricao} (${veiculo.placa})` : "sem veículo"}
                  {e.previsao_data ? ` · previsão ${dateBR(e.previsao_data)}` : ""}
                  {pedido?.clientes?.telefone ? ` · ${pedido.clientes.telefone}` : ""}
                </p>

                <ul className="mt-3 space-y-1 rounded-md bg-secondary/60 p-3 text-sm">
                  {itens.map((i) => (
                    <li key={i.id} className="flex items-start justify-between gap-2">
                      <span className="flex min-w-0 items-start gap-2">
                        <Package className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">{i.produtos?.descricao ?? "—"}</span>
                      </span>
                      <span className="text-numeric shrink-0">{num(Number(i.quantidade))}</span>
                    </li>
                  ))}
                </ul>

                {e.observacao && (
                  <p className="mt-2 text-xs text-muted-foreground">Obs.: {e.observacao}</p>
                )}

                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {e.situacao === "planejada" ? (
                    <Button
                      className="h-11"
                      onClick={() => iniciar.mutate(e.id)}
                      disabled={iniciar.isPending}
                    >
                      <Play className="size-4" /> Sair para rota
                    </Button>
                  ) : (
                    <Button
                      className="h-11"
                      onClick={() => {
                        setEntregaId(e.id);
                        const inicial: Record<string, string> = {};
                        for (const i of itens) inicial[i.id] = String(Number(i.quantidade));
                        setQtds(inicial);
                      }}
                    >
                      <Truck className="size-4" /> Confirmar entrega
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className="h-11"
                    onClick={() => {
                      setInsucessoId(e.id);
                      setMotivo(motivosInsucesso[0]);
                    }}
                  >
                    <XCircle className="size-4" /> Não consegui entregar
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={entregaId !== null} onOpenChange={(o) => !o && setEntregaId(null)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Confirmar entrega</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Quem recebeu</Label>
                <Input
                  value={recebedor}
                  placeholder="Nome do recebedor"
                  onChange={(ev) => setRecebedor(ev.target.value)}
                />
              </div>
              <div>
                <Label>Documento</Label>
                <Input
                  value={documento}
                  placeholder="RG ou CPF"
                  onChange={(ev) => setDocumento(ev.target.value)}
                />
              </div>
            </div>

            <div>
              <Label>Quantidades entregues</Label>
              <div className="mt-1 space-y-2 rounded-md border border-border p-3">
                {itensAtuais.map((i) => (
                  <div key={i.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{i.produtos?.descricao ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        planejado {num(Number(i.quantidade))}
                      </p>
                    </div>
                    <Input
                      className="w-24 text-right"
                      value={qtds[i.id] ?? ""}
                      onChange={(ev) => setQtds({ ...qtds, [i.id]: ev.target.value })}
                    />
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Entregou menos do que foi planejado? O sistema registra a divergência e mantém o
                  restante pendente no pedido.
                </p>
              </div>
            </div>

            <div>
              <Label>Foto da entrega</Label>
              <div className="mt-1 flex items-center gap-2">
                <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm">
                  <Camera className="size-4" />
                  {foto ? "Trocar foto" : "Tirar foto"}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(ev) => setFoto(ev.target.files?.[0] ?? null)}
                  />
                </label>
                {foto && <span className="truncate text-xs text-muted-foreground">{foto.name}</span>}
              </div>
            </div>

            <div>
              <Label>Assinatura do recebedor</Label>
              <Assinatura onChange={setAssinatura} />
            </div>

            <div>
              <Label>Observação</Label>
              <Textarea
                value={observacao}
                rows={2}
                onChange={(ev) => setObservacao(ev.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEntregaId(null)}>
              Cancelar
            </Button>
            <Button onClick={() => concluir.mutate()} disabled={concluir.isPending}>
              Confirmar entrega
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={insucessoId !== null} onOpenChange={(o) => !o && setInsucessoId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Não consegui entregar</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Motivo</Label>
              <Select value={motivo} onValueChange={setMotivo}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {motivosInsucesso.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>O que aconteceu</Label>
              <Textarea value={motivoObs} rows={3} onChange={(ev) => setMotivoObs(ev.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInsucessoId(null)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              onClick={() => registrarInsucesso.mutate()}
              disabled={registrarInsucesso.isPending}
            >
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
