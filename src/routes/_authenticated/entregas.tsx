import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, MapPin, Play, Search, Truck, XCircle } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { dateBR, dateTimeBR, num } from "@/lib/format";
import { corEntrega, enderecoPedido, labelEntrega, motivosInsucesso, situacoesEntrega } from "@/lib/entrega";
import { PageHeader, EmptyState, StatCard } from "@/components/app/PageHeader";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/entregas")({
  head: () => ({
    meta: [
      { title: "Entregas — Ze Obra" },
      {
        name: "description",
        content: "Planejamento de entregas por veículo e motorista, com saída para rota e baixa.",
      },
      { property: "og:title", content: "Entregas — Ze Obra" },
      { property: "og:description", content: "Rotas do dia, veículos, motoristas e comprovantes." },
    ],
  }),
  component: Entregas,
});

type PedidoItem = {
  id: string;
  produto_id: string;
  quantidade: number;
  quantidade_entregue: number;
  unidade: string;
  produtos: { descricao: string; codigo_interno: string } | null;
};

function Entregas() {
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("abertas");
  const [planejar, setPlanejar] = useState(false);
  const [pedidoId, setPedidoId] = useState("");
  const [veiculoId, setVeiculoId] = useState("");
  const [motoristaId, setMotoristaId] = useState("");
  const [previsao, setPrevisao] = useState("");
  const [sequencia, setSequencia] = useState("");
  const [obs, setObs] = useState("");
  const [qtds, setQtds] = useState<Record<string, string>>({});
  const [insucessoId, setInsucessoId] = useState<string | null>(null);
  const [motivo, setMotivo] = useState<string>(motivosInsucesso[0]);
  const [motivoObs, setMotivoObs] = useState("");

  const { data: entregas = [], isLoading } = useQuery({
    queryKey: ["entregas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entregas")
        .select(
          "*, veiculos(placa, descricao), motoristas(nome), pedidos(numero, entrega_endereco, entrega_numero, entrega_bairro, entrega_cidade, entrega_estado, clientes(nome)), entrega_itens(quantidade, produtos(descricao))",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: pedidos = [] } = useQuery({
    queryKey: ["pedidos-para-entrega"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pedidos")
        .select(
          "id, numero, situacao, previsao_entrega, entrega_endereco, entrega_numero, entrega_bairro, entrega_cidade, entrega_estado, clientes(nome), pedido_itens(id, produto_id, quantidade, quantidade_entregue, unidade, produtos(descricao, codigo_interno))",
        )
        .in("situacao", ["pronto_entrega", "em_rota"])
        .order("numero");
      if (error) throw error;
      return data;
    },
  });

  const { data: veiculos = [] } = useQuery({
    queryKey: ["veiculos-ativos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("veiculos")
        .select("id, placa, descricao")
        .eq("ativo", true)
        .order("descricao");
      if (error) throw error;
      return data;
    },
  });

  const { data: motoristas = [] } = useQuery({
    queryKey: ["motoristas-ativos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("motoristas")
        .select("id, nome, veiculo_id")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data;
    },
  });

  const pedidoSelecionado = pedidos.find((p) => p.id === pedidoId);
  const itensPedido = (pedidoSelecionado?.pedido_itens ?? []) as unknown as PedidoItem[];

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return entregas.filter((e) => {
      if (filtro === "abertas" && !["planejada", "em_rota"].includes(e.situacao)) return false;
      if (filtro !== "abertas" && filtro !== "todas" && e.situacao !== filtro) return false;
      if (!t) return true;
      const pedido = e.pedidos as unknown as
        | { numero: number; clientes: { nome: string } | null }
        | null;
      return [
        String(e.numero),
        String(pedido?.numero ?? ""),
        pedido?.clientes?.nome ?? "",
        (e.motoristas as unknown as { nome: string } | null)?.nome ?? "",
        (e.veiculos as unknown as { placa: string } | null)?.placa ?? "",
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(t));
    });
  }, [entregas, busca, filtro]);

  const hoje = new Date().toDateString();
  const stats = {
    planejadas: entregas.filter((e) => e.situacao === "planejada").length,
    rota: entregas.filter((e) => e.situacao === "em_rota").length,
    entreguesHoje: entregas.filter(
      (e) => e.situacao === "entregue" && e.data_entrega && new Date(e.data_entrega).toDateString() === hoje,
    ).length,
    insucesso: entregas.filter((e) => e.situacao === "insucesso").length,
  };

  const criar = useMutation({
    mutationFn: async () => {
      if (!pedidoId) throw new Error("Escolha o pedido");
      const itens = itensPedido
        .map((i) => ({ pedido_item_id: i.id, quantidade: Number(qtds[i.id] ?? 0) }))
        .filter((i) => i.quantidade > 0);
      if (itens.length === 0) throw new Error("Informe a quantidade de ao menos um produto");
      const { error } = await supabase.rpc("planejar_entrega", {
        p_pedido_id: pedidoId,
        p_itens: itens,
        ...(veiculoId ? { p_veiculo_id: veiculoId } : {}),
        ...(motoristaId ? { p_motorista_id: motoristaId } : {}),
        ...(previsao ? { p_previsao: previsao } : {}),
        ...(sequencia ? { p_sequencia: Number(sequencia) } : {}),
        ...(obs ? { p_observacao: obs } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Entrega planejada.");
      setPlanejar(false);
      setPedidoId("");
      setQtds({});
      setObs("");
      setSequencia("");
      void queryClient.invalidateQueries({ queryKey: ["entregas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const iniciar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("entrega_iniciar_rota", { p_entrega_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Entrega em rota.");
      void queryClient.invalidateQueries({ queryKey: ["entregas"] });
      void queryClient.invalidateQueries({ queryKey: ["pedidos-para-entrega"] });
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
      void queryClient.invalidateQueries({ queryKey: ["entregas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Entregas"
        description="Monte a rota do dia, defina veículo e motorista e acompanhe cada entrega."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/motorista">Tela do motorista</Link>
            </Button>
            <Button
              onClick={() => {
                setPlanejar(true);
                setQtds({});
              }}
            >
              <Truck className="size-4" /> Planejar entrega
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Planejadas" value={String(stats.planejadas)} icon={CalendarClock} />
        <StatCard label="Em rota" value={String(stats.rota)} icon={Truck} tone="accent" />
        <StatCard label="Entregues hoje" value={String(stats.entreguesHoje)} tone="success" />
        <StatCard
          label="Sem sucesso"
          value={String(stats.insucesso)}
          tone={stats.insucesso > 0 ? "danger" : "default"}
        />
      </div>

      <div className="panel mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por entrega, pedido, cliente, motorista ou placa"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <Select value={filtro} onValueChange={setFiltro}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="abertas">Em aberto</SelectItem>
            <SelectItem value="todas">Todas</SelectItem>
            {situacoesEntrega.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhuma entrega encontrada."
          description="Planeje uma entrega a partir de um pedido pronto para entrega."
          action={<Button onClick={() => setPlanejar(true)}>Planejar entrega</Button>}
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entrega</TableHead>
                <TableHead>Pedido / cliente</TableHead>
                <TableHead>Endereço</TableHead>
                <TableHead>Previsão</TableHead>
                <TableHead>Veículo / motorista</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((e) => {
                const pedido = e.pedidos as unknown as
                  | {
                      numero: number;
                      entrega_endereco: string | null;
                      entrega_numero: string | null;
                      entrega_bairro: string | null;
                      entrega_cidade: string | null;
                      entrega_estado: string | null;
                      clientes: { nome: string } | null;
                    }
                  | null;
                const veiculo = e.veiculos as unknown as { placa: string; descricao: string } | null;
                const motorista = e.motoristas as unknown as { nome: string } | null;
                const itens = (e.entrega_itens ?? []) as unknown as {
                  quantidade: number;
                  produtos: { descricao: string } | null;
                }[];
                return (
                  <TableRow key={e.id}>
                    <TableCell>
                      <p className="font-medium text-numeric">#{String(e.numero).padStart(4, "0")}</p>
                      <p className="text-xs text-muted-foreground">
                        {itens.length} {itens.length === 1 ? "produto" : "produtos"}
                        {e.data_entrega ? ` · ${dateTimeBR(e.data_entrega)}` : ""}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{pedido?.clientes?.nome ?? "—"}</p>
                      <p className="text-xs text-muted-foreground text-numeric">
                        Pedido #{String(pedido?.numero ?? "").padStart(4, "0")}
                      </p>
                    </TableCell>
                    <TableCell className="max-w-72 text-xs text-muted-foreground">
                      <span className="inline-flex items-start gap-1">
                        <MapPin className="mt-0.5 size-3 shrink-0" />
                        {pedido ? enderecoPedido(pedido) : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{dateBR(e.previsao_data)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {veiculo ? `${veiculo.descricao} (${veiculo.placa})` : "sem veículo"}
                      <br />
                      {motorista?.nome ?? "sem motorista"}
                    </TableCell>
                    <TableCell>
                      <Badge className={corEntrega(e.situacao)}>{labelEntrega(e.situacao)}</Badge>
                      {e.motivo_insucesso && (
                        <p className="mt-1 text-xs text-muted-foreground">{e.motivo_insucesso}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {e.situacao === "planejada" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => iniciar.mutate(e.id)}
                          disabled={iniciar.isPending}
                        >
                          <Play className="size-4" /> Sair para rota
                        </Button>
                      )}
                      {["planejada", "em_rota"].includes(e.situacao) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-1"
                          onClick={() => {
                            setInsucessoId(e.id);
                            setMotivo(motivosInsucesso[0]);
                          }}
                        >
                          <XCircle className="size-4" /> Insucesso
                        </Button>
                      )}
                      {e.situacao === "entregue" && (
                        <span className="text-xs text-muted-foreground">
                          Recebido por {e.recebedor ?? "—"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={planejar} onOpenChange={setPlanejar}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Planejar entrega</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Pedido pronto para entrega</Label>
              <Select
                value={pedidoId}
                onValueChange={(v) => {
                  setPedidoId(v);
                  const p = pedidos.find((x) => x.id === v);
                  const itens = (p?.pedido_itens ?? []) as unknown as PedidoItem[];
                  const inicial: Record<string, string> = {};
                  for (const i of itens) {
                    const pendente = Number(i.quantidade) - Number(i.quantidade_entregue);
                    if (pendente > 0) inicial[i.id] = String(pendente);
                  }
                  setQtds(inicial);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Escolha o pedido" />
                </SelectTrigger>
                <SelectContent>
                  {pedidos.map((p) => {
                    const cliente = p.clientes as unknown as { nome: string } | null;
                    return (
                      <SelectItem key={p.id} value={p.id}>
                        #{String(p.numero).padStart(4, "0")} — {cliente?.nome ?? "—"}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {pedidoSelecionado && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {enderecoPedido(pedidoSelecionado)}
                </p>
              )}
            </div>
            <div>
              <Label>Veículo</Label>
              <Select
                value={veiculoId}
                onValueChange={(v) => setVeiculoId(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Escolha o veículo" />
                </SelectTrigger>
                <SelectContent>
                  {veiculos.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.descricao} ({v.placa})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Motorista</Label>
              <Select
                value={motoristaId}
                onValueChange={(v) => {
                  setMotoristaId(v);
                  const m = motoristas.find((x) => x.id === v);
                  if (m?.veiculo_id && !veiculoId) setVeiculoId(m.veiculo_id);
                }}
              >
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
            <div>
              <Label>Previsão</Label>
              <Input type="date" value={previsao} onChange={(e) => setPrevisao(e.target.value)} />
            </div>
            <div>
              <Label>Ordem na rota</Label>
              <Input
                value={sequencia}
                placeholder="1"
                onChange={(e) => setSequencia(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Observação para o motorista</Label>
              <Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} />
            </div>
          </div>

          {itensPedido.length > 0 && (
            <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Pendente</TableHead>
                    <TableHead className="w-32 text-right">Levar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itensPedido.map((i) => {
                    const pendente = Number(i.quantidade) - Number(i.quantidade_entregue);
                    return (
                      <TableRow key={i.id}>
                        <TableCell>
                          <p className="text-sm font-medium">{i.produtos?.descricao ?? "—"}</p>
                          <p className="text-xs text-muted-foreground">
                            {i.produtos?.codigo_interno} · {i.unidade}
                          </p>
                        </TableCell>
                        <TableCell className="text-right text-numeric text-sm">
                          {num(pendente)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            className="text-right"
                            value={qtds[i.id] ?? ""}
                            disabled={pendente <= 0}
                            onChange={(e) => setQtds({ ...qtds, [i.id]: e.target.value })}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanejar(false)}>
              Cancelar
            </Button>
            <Button onClick={() => criar.mutate()} disabled={criar.isPending}>
              Planejar entrega
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={insucessoId !== null} onOpenChange={(o) => !o && setInsucessoId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Entrega sem sucesso</DialogTitle>
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
              <Label>Detalhes</Label>
              <Textarea value={motivoObs} onChange={(e) => setMotivoObs(e.target.value)} rows={3} />
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
              Registrar insucesso
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
