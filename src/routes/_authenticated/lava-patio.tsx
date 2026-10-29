import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Camera,
  ClipboardCheck,
  Clock,
  Plus,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { ChecklistAvarias } from "@/components/app/ChecklistAvarias";
import { FotosOrdem } from "@/components/app/FotosOrdem";
import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { brl } from "@/lib/format";
import { textoFotos } from "@/lib/lava-fotos";
import {
  SITUACOES,
  estadoDoChecklist,
  formatarIdentificacao,
  minutosNoPatio,
  motivoDeNaoIniciar,
  podeMudarPara,
  precoDoServico,
  proximaSituacao,
  rotuloSituacao,
  rotuloCobertura,
  rotuloTipo,
  textoChecklist,
  textoTempo,
  totalCobrado,
  type SituacaoOrdem,
} from "@/lib/lava-rapido";

export const Route = createFileRoute("/_authenticated/lava-patio")({
  head: () => ({
    meta: [
      { title: "Pátio do lava rápido — EZRA ERP" },
      {
        name: "description",
        content: "Quadro do pátio: aguardando, lavando, secando e pronto para entregar.",
      },
    ],
  }),
  component: PatioModulo,
});

const SEM_LAVADOR = "__sem";

function PatioModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.lavarapido) return <ModuloBloqueado modulo="lavarapido" />;
  return <Patio />;
}

function Patio() {
  const qc = useQueryClient();
  const navegar = useNavigate();
  const [nova, setNova] = useState(false);
  const [cancelando, setCancelando] = useState<string | null>(null);
  const [checklistDe, setChecklistDe] = useState<string | null>(null);
  const [fotosDe, setFotosDe] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["lava-patio"],
    // o pátio fica aberto o dia todo: atualiza sozinho para mostrar o que outro balcão mudou
    refetchInterval: 30000,
    queryFn: async () => {
      const [ordens, veiculos, clientes, lavadores, servicos, precos, produtos] = await Promise.all(
        [
          supabase
            .from("lr_ordens")
            .select("*")
            .in("situacao", ["aguardando", "lavando", "secando", "pronto"])
            .order("entrada_em"),
          supabase.from("lr_veiculos").select("*").order("identificacao"),
          supabase.from("clientes").select("id, nome").order("nome").limit(2000),
          supabase.from("lr_lavadores").select("*").order("nome"),
          supabase.from("lr_servicos").select("*").eq("ativo", true).order("nome"),
          supabase.from("lr_servico_precos").select("*"),
          supabase.from("produtos").select("id, preco_venda").eq("controla_estoque", false),
        ],
      );
      for (const r of [ordens, veiculos, clientes, lavadores, servicos, precos, produtos])
        if (r.error) throw r.error;
      const ids = (ordens.data ?? []).map((o) => o.id);
      const itens = ids.length
        ? await supabase.from("lr_ordem_itens").select("*").in("ordem_id", ids)
        : { data: [], error: null };
      if (itens.error) throw itens.error;
      const avarias = ids.length
        ? await supabase
            .from("lr_avarias")
            .select("id, ordem_id, lugar, tipo, descricao")
            .in("ordem_id", ids)
            .order("created_at")
        : { data: [], error: null };
      if (avarias.error) throw avarias.error;
      const cfg = await supabase.from("lr_config").select("checklist_obrigatorio").maybeSingle();
      if (cfg.error) throw cfg.error;
      const fotos = ids.length
        ? await supabase.rpc("lr_fotos_contagem", { p_ordens: ids })
        : { data: {}, error: null };
      if (fotos.error) throw fotos.error;
      return {
        ordens: ordens.data ?? [],
        veiculos: veiculos.data ?? [],
        clientes: clientes.data ?? [],
        lavadores: lavadores.data ?? [],
        servicos: servicos.data ?? [],
        precos: precos.data ?? [],
        produtos: produtos.data ?? [],
        itens: itens.data ?? [],
        avarias: avarias.data ?? [],
        checklistObrigatorio: cfg.data?.checklist_obrigatorio ?? false,
        fotos: (fotos.data ?? {}) as unknown as Record<string, { antes: number; depois: number }>,
      };
    },
  });

  const veiculo = (id: string) => data?.veiculos.find((v) => v.id === id);
  const cliente = (id: string) => data?.clientes.find((c) => c.id === id)?.nome ?? "";
  const nomeServico = (id: string) => data?.servicos.find((s) => s.id === id)?.nome ?? "Serviço";
  const lavadoresAtivos = (data?.lavadores ?? []).filter((l) => l.ativo);

  const atualizar = () => void qc.invalidateQueries({ queryKey: ["lava-patio"] });

  const mudar = useMutation({
    mutationFn: async (p: { id: string; para: SituacaoOrdem; motivo?: string }) => {
      const { error } = await supabase.rpc("lr_ordem_situacao", {
        p_id: p.id,
        p_para: p.para,
        ...(p.motivo ? { p_motivo: p.motivo } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setCancelando(null);
      setMotivo("");
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Ordem só de itens cobertos por plano ou brinde: entrega direto, sem passar pelo caixa. */
  const entregar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("lr_ordem_retirar", { p_ordem_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Veículo entregue.");
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: session } = useSessionData();
  const podeConfigurar = (session?.roles ?? []).some((r) =>
    ["administrador", "gestor"].includes(r),
  );
  const config = useMutation({
    mutationFn: async (obrigatorio: boolean) => {
      const { error } = await supabase.rpc("lr_config_salvar", {
        p_checklist_obrigatorio: obrigatorio,
      });
      if (error) throw error;
    },
    onSuccess: atualizar,
    onError: (e: Error) => toast.error(e.message),
  });

  const atribuir = useMutation({
    mutationFn: async (p: { id: string; lavadorId: string | null; box: string | null }) => {
      const { error } = await supabase.rpc("lr_ordem_atribuir", {
        p_id: p.id,
        p_lavador_id: p.lavadorId as string,
        ...(p.box ? { p_box: p.box } : {}),
      });
      if (error) throw error;
    },
    onSuccess: atualizar,
    onError: (e: Error) => toast.error(e.message),
  });

  const colunas = useMemo(
    () =>
      SITUACOES.map((s) => ({
        ...s,
        ordens: (data?.ordens ?? []).filter((o) => o.situacao === s.value),
      })),
    [data],
  );

  function avancar(id: string, atual: SituacaoOrdem, lavadorId: string | null) {
    const prox = proximaSituacao(atual);
    if (!prox) return;
    if (prox === "lavando") {
      const aviso = motivoDeNaoIniciar(lavadorId);
      if (aviso) {
        toast.error(aviso);
        return;
      }
      const ordem = data?.ordens.find((x) => x.id === id);
      if (data?.checklistObrigatorio && ordem && estadoDoChecklist(ordem) === "pendente") {
        toast.error("Conclua o checklist de avarias antes de começar a lavagem.");
        setChecklistDe(id);
        return;
      }
    }
    mudar.mutate({ id, para: prox });
  }

  return (
    <div>
      <PageHeader
        title="Pátio"
        description="Cada veículo passa por aguardando, lavando, secando e pronto. Pronto segue para a entrega e cobrança no caixa."
        actions={
          <Button onClick={() => setNova(true)}>
            <Plus className="size-4" /> Nova ordem
          </Button>
        }
      />

      {podeConfigurar && !isLoading && (
        <label className="mb-4 flex items-center gap-2 text-sm">
          <Switch
            checked={data?.checklistObrigatorio ?? false}
            disabled={config.isPending}
            onCheckedChange={(v) => config.mutate(v)}
          />
          Exigir o checklist de avarias antes de começar a lavagem
        </label>
      )}

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : (data?.ordens.length ?? 0) === 0 ? (
        <EmptyState
          title="Pátio vazio"
          description="Abra uma ordem para o veículo que acabou de chegar."
          action={
            <Button onClick={() => setNova(true)}>
              <Plus className="size-4" /> Nova ordem
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {colunas.map((col) => (
            <section key={col.value} aria-label={col.label}>
              <h2 className="mb-2 flex items-center justify-between text-sm font-semibold">
                {col.label}
                <Badge variant="secondary">{col.ordens.length}</Badge>
              </h2>
              <div className="space-y-3">
                {col.ordens.map((o) => {
                  const v = veiculo(o.veiculo_id);
                  const itens = (data?.itens ?? []).filter((i) => i.ordem_id === o.id);
                  const total = totalCobrado(
                    itens.map((i) => ({
                      preco_aplicado: Number(i.preco_aplicado),
                      cobertura: i.cobertura,
                    })),
                  );
                  const tudoCoberto = itens.length > 0 && itens.every((i) => i.cobertura);
                  const situacao = o.situacao as SituacaoOrdem;
                  const prox = proximaSituacao(situacao);
                  const tempo = minutosNoPatio(o.entrada_em);
                  return (
                    <article key={o.id} className="panel space-y-2 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-display text-base font-bold">
                            {v ? formatarIdentificacao(v.tipo, v.identificacao) : "—"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {[v ? rotuloTipo(v.tipo) : "", v?.fabricante, v?.modelo]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="size-3" /> {textoTempo(tempo)}
                        </span>
                      </div>
                      <p className="text-sm">{cliente(o.cliente_id)}</p>
                      <ul className="text-xs text-muted-foreground">
                        {itens.map((i) => (
                          <li key={i.id}>
                            {nomeServico(i.servico_id)} ·{" "}
                            {i.cobertura ? (
                              <Badge variant="secondary">{rotuloCobertura(i.cobertura)}</Badge>
                            ) : (
                              brl(Number(i.preco_aplicado))
                            )}
                          </li>
                        ))}
                      </ul>
                      <p className="text-sm font-semibold">{brl(total)}</p>
                      {o.observacoes && (
                        <p className="text-xs text-muted-foreground">{o.observacoes}</p>
                      )}
                      <button
                        type="button"
                        className="flex items-center gap-1 text-xs underline-offset-2 hover:underline"
                        onClick={() => setChecklistDe(o.id)}
                      >
                        <ClipboardCheck className="size-3" />
                        {textoChecklist(
                          estadoDoChecklist(o),
                          (data?.avarias ?? []).filter((a) => a.ordem_id === o.id).length,
                        )}
                      </button>
                      <button
                        type="button"
                        className="flex items-center gap-1 text-xs underline-offset-2 hover:underline"
                        onClick={() => setFotosDe(o.id)}
                      >
                        <Camera className="size-3" />
                        {textoFotos(data?.fotos[o.id]?.antes ?? 0, data?.fotos[o.id]?.depois ?? 0)}
                      </button>

                      <Select
                        value={o.lavador_id ?? SEM_LAVADOR}
                        onValueChange={(val) =>
                          atribuir.mutate({
                            id: o.id,
                            lavadorId: val === SEM_LAVADOR ? null : val,
                            box: o.box,
                          })
                        }
                      >
                        <SelectTrigger aria-label="Lavador" className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SEM_LAVADOR}>Sem lavador</SelectItem>
                          {lavadoresAtivos.map((l) => (
                            <SelectItem key={l.id} value={l.id}>
                              {l.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {o.box && <p className="text-xs text-muted-foreground">Local: {o.box}</p>}

                      <div className="flex flex-wrap gap-2 pt-1">
                        {situacao === "pronto" ? (
                          <Button
                            size="sm"
                            disabled={entregar.isPending}
                            onClick={() =>
                              tudoCoberto
                                ? entregar.mutate(o.id)
                                : void navegar({ to: "/frente-caixa", search: { lava: o.id } })
                            }
                          >
                            <Banknote className="size-4" />{" "}
                            {tudoCoberto ? "Entregar (sem cobrança)" : "Entregar e cobrar"}
                          </Button>
                        ) : (
                          prox && (
                            <Button
                              size="sm"
                              disabled={mudar.isPending}
                              onClick={() => avancar(o.id, situacao, o.lavador_id)}
                            >
                              {rotuloSituacao(prox)} <ArrowRight className="size-4" />
                            </Button>
                          )
                        )}
                        {podeMudarPara(situacao, "pronto") && prox !== "pronto" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={mudar.isPending}
                            onClick={() => mudar.mutate({ id: o.id, para: "pronto" })}
                          >
                            Pronto
                          </Button>
                        )}
                        {situacao !== "aguardando" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Voltar um passo"
                            disabled={mudar.isPending}
                            onClick={() =>
                              mudar.mutate({
                                id: o.id,
                                para:
                                  situacao === "pronto"
                                    ? "secando"
                                    : situacao === "secando"
                                      ? "lavando"
                                      : "aguardando",
                              })
                            }
                          >
                            <ArrowLeft className="size-4" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Cancelar ordem"
                          onClick={() => setCancelando(o.id)}
                        >
                          <XCircle className="size-4" />
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {checklistDe &&
        data &&
        (() => {
          const ordem = data.ordens.find((x) => x.id === checklistDe);
          const veic = ordem && data.veiculos.find((x) => x.id === ordem.veiculo_id);
          return ordem && veic ? (
            <ChecklistAvarias
              ordem={ordem}
              veiculo={veic}
              avarias={data.avarias.filter((a) => a.ordem_id === ordem.id)}
              onFechar={() => setChecklistDe(null)}
            />
          ) : null;
        })()}

      {fotosDe &&
        data &&
        (() => {
          const ordem = data.ordens.find((x) => x.id === fotosDe);
          const veic = ordem && data.veiculos.find((x) => x.id === ordem.veiculo_id);
          return ordem && veic ? (
            <FotosOrdem ordemId={ordem.id} veiculo={veic} onFechar={() => setFotosDe(null)} />
          ) : null;
        })()}

      {nova && data && (
        <NovaOrdem
          dados={data}
          onFechar={() => setNova(false)}
          onCriada={() => {
            setNova(false);
            atualizar();
          }}
        />
      )}

      <Dialog open={!!cancelando} onOpenChange={(o) => !o && setCancelando(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancelar ordem</DialogTitle>
          </DialogHeader>
          <Label htmlFor="lv-motivo">Motivo</Label>
          <Textarea
            id="lv-motivo"
            rows={2}
            value={motivo}
            placeholder="Ex.: cliente desistiu"
            onChange={(e) => setMotivo(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelando(null)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={mudar.isPending}
              onClick={() =>
                cancelando && mudar.mutate({ id: cancelando, para: "cancelada", motivo })
              }
            >
              Cancelar ordem
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** O que a tela de nova ordem precisa do que o pátio já carregou. */
type Dados = {
  ordens: { veiculo_id: string }[];
  veiculos: {
    id: string;
    cliente_id: string;
    tipo: string;
    identificacao: string;
    fabricante: string;
    modelo: string;
    ativo: boolean;
  }[];
  clientes: { id: string; nome: string }[];
  lavadores: { id: string; nome: string; ativo: boolean }[];
  servicos: { id: string; nome: string; produto_id: string }[];
  precos: { servico_id: string; tipo: string | null; preco: number }[];
  produtos: { id: string; preco_venda: number | null }[];
};

function NovaOrdem({
  dados,
  onFechar,
  onCriada,
}: {
  dados: Dados;
  onFechar: () => void;
  onCriada: () => void;
}) {
  const [veiculoId, setVeiculoId] = useState("");
  const [lavadorId, setLavadorId] = useState("");
  const [box, setBox] = useState("");
  const [obs, setObs] = useState("");
  const [escolhidos, setEscolhidos] = useState<string[]>([]);

  const ocupados = new Set(dados.ordens.map((o) => o.veiculo_id));
  const disponiveis = dados.veiculos.filter((v) => v.ativo && !ocupados.has(v.id));
  const v = dados.veiculos.find((x) => x.id === veiculoId);

  const precoDe = (servicoId: string) => {
    const sv = dados.servicos.find((s) => s.id === servicoId);
    if (!v || !sv) return 0;
    const balcao = Number(dados.produtos.find((p) => p.id === sv.produto_id)?.preco_venda ?? 0);
    return precoDoServico(
      v.tipo,
      dados.precos
        .filter((p) => p.servico_id === servicoId)
        .map((p) => ({ tipo: p.tipo, preco: Number(p.preco) })),
      balcao,
    );
  };
  // plano do veículo e brinde de fidelidade: o banco diz o que fica coberto (mesma regra de quando a ordem é aberta)
  const { data: previa = [] } = useQuery({
    queryKey: ["lava-cobertura-previa", veiculoId, [...escolhidos].sort().join(",")],
    enabled: !!veiculoId && escolhidos.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("lr_cobertura_previa", {
        p_veiculo_id: veiculoId,
        p_servicos: escolhidos,
      });
      if (error) throw error;
      return (data ?? []) as unknown as { servico_id: string; cobertura: string | null }[];
    },
  });
  const coberturaDe = (servicoId: string) =>
    escolhidos.includes(servicoId)
      ? (previa.find((p) => p.servico_id === servicoId)?.cobertura ?? null)
      : null;
  const total = escolhidos.reduce((s, id) => (coberturaDe(id) ? s : s + precoDe(id)), 0);

  const criar = useMutation({
    mutationFn: async () => {
      if (!veiculoId) throw new Error("Escolha o veículo.");
      if (escolhidos.length === 0) throw new Error("Escolha ao menos um serviço.");
      const { error } = await supabase.rpc("lr_ordem_criar", {
        p_dados: {
          veiculo_id: veiculoId,
          lavador_id: lavadorId || null,
          box,
          observacoes: obs,
          servicos: escolhidos,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ordem aberta.");
      onCriada();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova ordem de lavagem</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label htmlFor="no-veiculo">Veículo</Label>
            <Select value={veiculoId} onValueChange={setVeiculoId}>
              <SelectTrigger id="no-veiculo">
                <SelectValue placeholder="Escolha o veículo" />
              </SelectTrigger>
              <SelectContent>
                {disponiveis.map((x) => (
                  <SelectItem key={x.id} value={x.id}>
                    {formatarIdentificacao(x.tipo, x.identificacao)} · {rotuloTipo(x.tipo)}
                    {` · ${x.fabricante} ${x.modelo}`} ·{" "}
                    {dados.clientes.find((c) => c.id === x.cliente_id)?.nome ?? ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {disponiveis.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Nenhum veículo livre. Cadastre o veículo em Veículos (quem já está no pátio não
                aparece aqui).
              </p>
            )}
          </div>

          <fieldset>
            <legend className="mb-1 text-sm font-medium">Serviços</legend>
            <div className="space-y-2">
              {dados.servicos.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={escolhidos.includes(s.id)}
                    onCheckedChange={(c) =>
                      setEscolhidos(
                        c ? [...escolhidos, s.id] : escolhidos.filter((x) => x !== s.id),
                      )
                    }
                  />
                  <span className="flex-1">{s.nome}</span>
                  <span className="text-muted-foreground">
                    {!v ? (
                      "—"
                    ) : coberturaDe(s.id) ? (
                      <Badge variant="secondary">{rotuloCobertura(coberturaDe(s.id))}</Badge>
                    ) : (
                      brl(precoDe(s.id))
                    )}
                  </span>
                </label>
              ))}
              {dados.servicos.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Cadastre os serviços em Serviços e preços.
                </p>
              )}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="no-lavador">Lavador</Label>
              <Select
                value={lavadorId || SEM_LAVADOR}
                onValueChange={(x) => setLavadorId(x === SEM_LAVADOR ? "" : x)}
              >
                <SelectTrigger id="no-lavador">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_LAVADOR}>Definir depois</SelectItem>
                  {dados.lavadores
                    .filter((l) => l.ativo)
                    .map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.nome}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="no-box">Box / local</Label>
              <Input
                id="no-box"
                value={box}
                placeholder="Ex.: Box 2, Hangar"
                onChange={(e) => setBox(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="no-obs">Observações</Label>
            <Textarea
              id="no-obs"
              rows={2}
              value={obs}
              placeholder="Avarias na entrada, pedidos do cliente"
              onChange={(e) => setObs(e.target.value)}
            />
          </div>
          <p className="text-right text-sm font-semibold">Total a cobrar: {brl(total)}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => criar.mutate()} disabled={criar.isPending}>
            Abrir ordem
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
