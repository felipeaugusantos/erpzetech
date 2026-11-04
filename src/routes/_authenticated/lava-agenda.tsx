import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CalendarPlus, ChevronLeft, ChevronRight, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { ClienteCombobox } from "@/components/app/ClienteCombobox";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { brl } from "@/lib/format";
import { isoBrasilia } from "@/lib/fuso";
import {
  REGRA_PADRAO,
  agendamentosDoBox,
  agendamentosDoLavador,
  boxesDosAgendamentos,
  deCampoLocal,
  erroDeRecurso,
  faixasDoDia,
  fimSugerido,
  horaBrasilia,
  instanteBrasilia,
  paraCampoLocal,
  podeRegistrarChegada,
  podeRemarcar,
  precoPrevisto,
  proximasSituacoes,
  rotuloSituacaoAgenda,
  servicosSemPreco,
  temConflito,
  totalPrevisto,
  type AgendamentoDaGrade,
  type RegraAgenda,
} from "@/lib/lava-agenda";
import { formatarIdentificacao, rotuloTipo } from "@/lib/lava-rapido";

export const Route = createFileRoute("/_authenticated/lava-agenda")({
  head: () => ({
    meta: [
      { title: "Agenda do lava rápido — EZRA ERP" },
      {
        name: "description",
        content:
          "Agenda de horários do lava rápido por lavador e por box, com confirmação, remarcação e registro de chegada.",
      },
    ],
  }),
  component: AgendaModulo,
});

const EXPEDIENTE = { abre: "07:00", fecha: "19:00", passoMin: 30 } as const;

function AgendaModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.lavarapido) return <ModuloBloqueado modulo="lavarapido" />;
  return <Agenda />;
}

type Item = { servico_id: string; preco_estimado: number | null; duracao_min: number };
type Linha = {
  id: string;
  veiculo_id: string;
  cliente_id: string;
  lavador_id: string | null;
  box: string | null;
  inicio: string;
  fim: string;
  situacao: string;
  observacoes: string | null;
  motivo: string | null;
  ordem_id: string | null;
  itens: Item[];
};

type Cadastros = {
  lavadores: { id: string; nome: string }[];
  servicos: { id: string; nome: string; duracao_min: number; preco_cadastro: number }[];
  precos: { servico_id: string; tipo: string | null; preco: number }[];
  clientes: { id: string; nome: string; cpf: string | null; telefone: string | null }[];
  veiculos: {
    id: string;
    cliente_id: string;
    tipo: string;
    identificacao: string;
    fabricante: string;
    modelo: string;
  }[];
  regra: RegraAgenda;
};

const somarDias = (dia: string, n: number) =>
  new Date(instanteBrasilia(dia, "12:00").getTime() + n * 86_400_000).toISOString().slice(0, 10);

const horario = (l: { inicio: string; fim: string }) =>
  `${horaBrasilia(new Date(l.inicio))}–${horaBrasilia(new Date(l.fim))}`;

const paraGrade = (l: Linha): AgendamentoDaGrade => ({
  id: l.id,
  inicio: new Date(l.inicio),
  fim: new Date(l.fim),
  situacao: l.situacao,
  lavador_id: l.lavador_id,
  box: l.box,
});

/** Agendamentos que tocam o dia (de Brasília), com os serviços previstos. */
function useAgendamentosDoDia(dia: string) {
  return useQuery({
    queryKey: ["lava-agenda", dia],
    queryFn: async () => {
      const ini = instanteBrasilia(dia, "00:00").toISOString();
      const fim = instanteBrasilia(somarDias(dia, 1), "00:00").toISOString();
      const { data, error } = await supabase
        .from("lr_agendamentos")
        .select("*, itens:lr_agendamento_itens(servico_id, preco_estimado, duracao_min)")
        .gt("fim", ini)
        .lt("inicio", fim)
        .order("inicio");
      if (error) throw error;
      return (data ?? []) as unknown as Linha[];
    },
  });
}

function Agenda() {
  const qc = useQueryClient();
  const navegar = useNavigate();
  const { data: session } = useSessionData();
  const gestao = (session?.roles ?? []).some((r) => ["administrador", "gestor"].includes(r));
  const [dia, setDia] = useState(isoBrasilia());
  const [form, setForm] = useState<
    | { modo: "novo"; lavadorId?: string; box?: string; inicio?: Date }
    | { modo: "remarcar"; ag: Linha }
    | null
  >(null);
  const [cancelando, setCancelando] = useState<Linha | null>(null);
  const [motivo, setMotivo] = useState("");
  const [regraAberta, setRegraAberta] = useState(false);

  const { data: ags = [], isLoading, error } = useAgendamentosDoDia(dia);
  const { data: cad } = useQuery({
    queryKey: ["lava-agenda-cadastros"],
    queryFn: async (): Promise<Cadastros> => {
      const [lav, srv, prc, prod, cli, vei, cfg] = await Promise.all([
        supabase.from("lr_lavadores").select("id, nome").eq("ativo", true).order("nome"),
        supabase
          .from("lr_servicos")
          .select("id, nome, duracao_min, produto_id")
          .eq("ativo", true)
          .order("nome"),
        supabase.from("lr_servico_precos").select("servico_id, tipo, preco"),
        supabase.from("produtos").select("id, preco_venda").eq("controla_estoque", false),
        supabase.from("clientes").select("id, nome, cpf, telefone").order("nome").limit(3000),
        supabase
          .from("lr_veiculos")
          .select("id, cliente_id, tipo, identificacao, fabricante, modelo")
          .eq("ativo", true),
        supabase.from("lr_agenda_config").select("*").maybeSingle(),
      ]);
      for (const r of [lav, srv, prc, prod, cli, vei, cfg]) if (r.error) throw r.error;
      const precoDoProduto = new Map(
        (prod.data ?? []).map((p) => [p.id, Number(p.preco_venda ?? 0)]),
      );
      return {
        lavadores: lav.data ?? [],
        servicos: (srv.data ?? []).map((s) => ({
          id: s.id,
          nome: s.nome,
          duracao_min: s.duracao_min,
          preco_cadastro: precoDoProduto.get(s.produto_id) ?? 0,
        })),
        precos: (prc.data ?? []).map((p) => ({
          servico_id: p.servico_id,
          tipo: p.tipo,
          preco: Number(p.preco),
        })),
        clientes: cli.data ?? [],
        veiculos: vei.data ?? [],
        regra: cfg.data
          ? {
              conflitoLavador: cfg.data.conflito_lavador,
              conflitoBox: cfg.data.conflito_box,
              exigirRecurso: cfg.data.exigir_recurso,
            }
          : REGRA_PADRAO,
      };
    },
  });

  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ["lava-agenda"] });
    void qc.invalidateQueries({ queryKey: ["lava-patio"] });
  };

  const nomeCliente = (id: string) => cad?.clientes.find((c) => c.id === id)?.nome ?? "—";
  const veiculo = (id: string) => cad?.veiculos.find((v) => v.id === id);
  const nomeServico = (id: string) => cad?.servicos.find((s) => s.id === id)?.nome ?? "Serviço";
  const nomeLavador = (id: string | null) =>
    id ? (cad?.lavadores.find((l) => l.id === id)?.nome ?? "—") : null;
  const noGrade = useMemo(() => ags.map(paraGrade), [ags]);
  const boxes = useMemo(() => boxesDosAgendamentos(ags), [ags]);

  const situacao = useMutation({
    mutationFn: async (p: { id: string; para: string; motivo?: string }) => {
      const { error } = await supabase.rpc("lr_agenda_situacao", {
        p_id: p.id,
        p_para: p.para,
        ...(p.motivo ? { p_motivo: p.motivo } : {}),
      });
      if (error) throw error;
    },
    onSuccess: (_r, v) => {
      toast.success(
        v.para === "confirmado"
          ? "Agendamento confirmado."
          : v.para === "cancelado"
            ? "Agendamento cancelado."
            : "Falta registrada.",
      );
      setCancelando(null);
      setMotivo("");
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const chegada = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("lr_agenda_chegada", { p_id: id });
      if (error) throw error;
      return data as unknown as { ordem_id: string; repetido: boolean };
    },
    onSuccess: (r) => {
      toast.success(
        r.repetido
          ? "Esta chegada já estava registrada: a ordem está no pátio."
          : "Chegada registrada: ordem criada no pátio (aguardando).",
      );
      atualizar();
      void navegar({ to: "/lava-patio" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const faixas = useMemo(() => faixasDoDia([], dia, EXPEDIENTE), [dia]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agenda do lava rápido"
        description="Horários livres e ocupados por lavador e por box. A chegada cria a ordem no pátio; a cobrança continua em Entregar e cobrar."
        actions={
          <>
            {gestao && (
              <Button variant="outline" onClick={() => setRegraAberta(true)}>
                <Settings2 className="size-4" /> Regra de conflito
              </Button>
            )}
            <Button onClick={() => setForm({ modo: "novo" })}>
              <CalendarPlus className="size-4" /> Novo agendamento
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Dia anterior"
          onClick={() => setDia(somarDias(dia, -1))}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <div>
          <Label htmlFor="ag-dia">Dia</Label>
          <Input
            id="ag-dia"
            type="date"
            value={dia}
            onChange={(e) => e.target.value && setDia(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Próximo dia"
          onClick={() => setDia(somarDias(dia, 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button variant="ghost" onClick={() => setDia(isoBrasilia())}>
          Hoje
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      ) : isLoading || !cad ? (
        <div className="panel h-40 animate-pulse" />
      ) : (
        <>
          <section aria-label="Visão do dia" className="panel w-0 min-w-full overflow-x-auto p-3">
            <div
              className="grid min-w-max gap-px text-xs"
              style={{ gridTemplateColumns: `9rem repeat(${faixas.length}, minmax(2.25rem, 1fr))` }}
            >
              <div />
              {faixas.map((f, i) => (
                <div key={i} className="px-0.5 text-center text-[10px] text-muted-foreground">
                  {i % 2 === 0 ? horaBrasilia(f.inicio).slice(0, 2) + "h" : ""}
                </div>
              ))}
              {[
                ...cad.lavadores.map((l) => ({
                  chave: `l-${l.id}`,
                  nome: l.nome,
                  tipo: "Lavador",
                  ags: agendamentosDoLavador(noGrade, l.id),
                  lavadorId: l.id,
                  box: undefined as string | undefined,
                })),
                ...boxes.map((b) => ({
                  chave: `b-${b}`,
                  nome: b,
                  tipo: "Box",
                  ags: agendamentosDoBox(noGrade, b),
                  lavadorId: undefined as string | undefined,
                  box: b as string | undefined,
                })),
              ].map((rec) => (
                <GradeLinha
                  key={rec.chave}
                  rec={rec}
                  dia={dia}
                  linhas={ags}
                  nomeCliente={nomeCliente}
                  veiculo={veiculo}
                  onLivre={(inicio) =>
                    setForm({
                      modo: "novo",
                      inicio,
                      ...(rec.lavadorId ? { lavadorId: rec.lavadorId } : {}),
                      ...(rec.box ? { box: rec.box } : {}),
                    })
                  }
                />
              ))}
            </div>
            {cad.lavadores.length === 0 && boxes.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">
                Cadastre os lavadores em Lavadores e comissões. Os boxes aparecem aqui conforme são
                usados nos agendamentos.
              </p>
            )}
            <p className="mt-2 px-1 text-xs text-muted-foreground">
              Cada coluna é de {EXPEDIENTE.passoMin} minutos ({EXPEDIENTE.abre} às{" "}
              {EXPEDIENTE.fecha}). Toque numa faixa livre para agendar nela.
            </p>
          </section>

          {ags.length === 0 ? (
            <EmptyState
              title="Nenhum agendamento neste dia"
              description="Use Novo agendamento ou toque numa faixa livre da grade."
            />
          ) : (
            <div className="panel w-0 min-w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Horário</TableHead>
                    <TableHead>Cliente e veículo</TableHead>
                    <TableHead>Serviços previstos</TableHead>
                    <TableHead>Lavador e box</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ags.map((l) => {
                    const v = veiculo(l.veiculo_id);
                    const semPreco = servicosSemPreco(
                      l.itens.map((i) => ({
                        nome: nomeServico(i.servico_id),
                        preco_estimado: i.preco_estimado,
                      })),
                    );
                    return (
                      <TableRow
                        key={l.id}
                        className={
                          l.situacao === "cancelado" || l.situacao === "faltou" ? "opacity-60" : ""
                        }
                      >
                        <TableCell className="whitespace-nowrap font-medium">
                          {horario(l)}
                        </TableCell>
                        <TableCell>
                          <div>{nomeCliente(l.cliente_id)}</div>
                          <div className="text-xs text-muted-foreground">
                            {v
                              ? `${formatarIdentificacao(v.tipo, v.identificacao)} · ${rotuloTipo(v.tipo)}`
                              : "—"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            {l.itens.map((i) => nomeServico(i.servico_id)).join(", ")}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Previsto {brl(totalPrevisto(l.itens))}
                            {semPreco.length > 0 && (
                              <span className="ml-1 text-destructive">
                                · sem preço cadastrado: {semPreco.join(", ")}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {nomeLavador(l.lavador_id) ?? (
                            <span className="text-muted-foreground">sem lavador</span>
                          )}
                          {l.box ? ` · ${l.box}` : ""}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              l.situacao === "confirmado" || l.situacao === "concluido"
                                ? "secondary"
                                : "outline"
                            }
                          >
                            {rotuloSituacaoAgenda(l.situacao)}
                          </Badge>
                          {l.motivo && (
                            <div className="mt-1 text-xs text-muted-foreground">{l.motivo}</div>
                          )}
                        </TableCell>
                        <TableCell className="space-x-1 text-right">
                          {podeRegistrarChegada(l.situacao) && (
                            <Button
                              size="sm"
                              disabled={chegada.isPending}
                              onClick={() => chegada.mutate(l.id)}
                            >
                              Registrar chegada
                            </Button>
                          )}
                          {l.ordem_id && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void navegar({ to: "/lava-patio" })}
                            >
                              Abrir no pátio
                            </Button>
                          )}
                          {proximasSituacoes(l.situacao).map((a) => (
                            <Button
                              key={a.para}
                              size="sm"
                              variant="outline"
                              disabled={situacao.isPending}
                              onClick={() =>
                                a.motivo
                                  ? (setCancelando(l), setMotivo(""))
                                  : situacao.mutate({ id: l.id, para: a.para })
                              }
                            >
                              {a.rotulo}
                            </Button>
                          ))}
                          {podeRemarcar(l.situacao) && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setForm({ modo: "remarcar", ag: l })}
                            >
                              Remarcar
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      {form && cad && (
        <FormAgendamento
          key={form.modo === "remarcar" ? form.ag.id : "novo"}
          estado={form}
          cad={cad}
          diaPadrao={dia}
          onFechar={() => setForm(null)}
          onSalvo={() => {
            setForm(null);
            atualizar();
          }}
        />
      )}

      <Dialog open={!!cancelando} onOpenChange={(o) => !o && setCancelando(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancelar agendamento</DialogTitle>
          </DialogHeader>
          <Label htmlFor="ag-motivo">Motivo</Label>
          <Textarea
            id="ag-motivo"
            rows={2}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelando(null)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={situacao.isPending || !motivo.trim()}
              onClick={() =>
                cancelando && situacao.mutate({ id: cancelando.id, para: "cancelado", motivo })
              }
            >
              Cancelar agendamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {regraAberta && cad && (
        <RegraDeConflito
          regra={cad.regra}
          onFechar={() => setRegraAberta(false)}
          onSalvo={() => {
            setRegraAberta(false);
            void qc.invalidateQueries({ queryKey: ["lava-agenda-cadastros"] });
          }}
        />
      )}
    </div>
  );
}

function GradeLinha({
  rec,
  dia,
  linhas,
  nomeCliente,
  veiculo,
  onLivre,
}: {
  rec: { nome: string; tipo: string; ags: AgendamentoDaGrade[] };
  dia: string;
  linhas: Linha[];
  nomeCliente: (id: string) => string;
  veiculo: (id: string) => { tipo: string; identificacao: string } | undefined;
  onLivre: (inicio: Date) => void;
}) {
  const faixas = useMemo(() => faixasDoDia(rec.ags, dia, EXPEDIENTE), [rec.ags, dia]);
  return (
    <>
      <div className="sticky left-0 z-10 flex flex-col justify-center bg-card py-1 pr-2">
        <span className="truncate text-sm font-medium">{rec.nome}</span>
        <span className="text-[10px] text-muted-foreground">{rec.tipo}</span>
      </div>
      {faixas.map((f, i) => {
        const l = f.agendamentoId ? linhas.find((x) => x.id === f.agendamentoId) : undefined;
        const hora = `${horaBrasilia(f.inicio)}–${horaBrasilia(f.fim)}`;
        if (!l)
          return (
            <button
              key={i}
              type="button"
              aria-label={`${rec.nome}, ${hora}, livre`}
              title={`${hora} livre`}
              onClick={() => onLivre(f.inicio)}
              className="h-8 rounded-sm bg-secondary hover:bg-accent/30"
            />
          );
        const v = veiculo(l.veiculo_id);
        return (
          <div
            key={i}
            role="img"
            aria-label={`${rec.nome}, ${hora}, ocupado`}
            title={`${horario(l)} · ${nomeCliente(l.cliente_id)}${v ? ` · ${formatarIdentificacao(v.tipo, v.identificacao)}` : ""} · ${rotuloSituacaoAgenda(l.situacao)}`}
            className={`h-8 rounded-sm ${l.situacao === "agendado" ? "bg-primary/40" : "bg-primary"}`}
          />
        );
      })}
    </>
  );
}

function FormAgendamento({
  estado,
  cad,
  diaPadrao,
  onFechar,
  onSalvo,
}: {
  estado:
    | { modo: "novo"; lavadorId?: string; box?: string; inicio?: Date }
    | { modo: "remarcar"; ag: Linha };
  cad: Cadastros;
  diaPadrao: string;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const remarcando = estado.modo === "remarcar" ? estado.ag : null;
  const [clienteId, setClienteId] = useState(remarcando?.cliente_id ?? "");
  const [veiculoId, setVeiculoId] = useState(remarcando?.veiculo_id ?? "");
  const [servicos, setServicos] = useState<string[]>(
    remarcando?.itens.map((i) => i.servico_id) ?? [],
  );
  const [lavadorId, setLavadorId] = useState(
    remarcando?.lavador_id ?? (estado.modo === "novo" ? (estado.lavadorId ?? "") : ""),
  );
  const [box, setBox] = useState(
    remarcando?.box ?? (estado.modo === "novo" ? (estado.box ?? "") : ""),
  );
  const [inicio, setInicio] = useState(
    paraCampoLocal(
      remarcando
        ? new Date(remarcando.inicio)
        : (estado.modo === "novo" && estado.inicio) || instanteBrasilia(diaPadrao, "09:00"),
    ),
  );
  const [fim, setFim] = useState(remarcando ? paraCampoLocal(new Date(remarcando.fim)) : "");
  const [fimManual, setFimManual] = useState(!!remarcando);
  const [obs, setObs] = useState(remarcando?.observacoes ?? "");

  const veiculosDoCliente = cad.veiculos.filter((v) => v.cliente_id === clienteId);
  const veic = cad.veiculos.find((v) => v.id === veiculoId);
  const escolhidos = cad.servicos.filter((s) => servicos.includes(s.id));
  const ini = deCampoLocal(inicio);
  const fimData = deCampoLocal(fim);

  // sem edição do fim, ele acompanha a soma das durações cadastradas dos serviços
  useEffect(() => {
    if (fimManual || !ini || escolhidos.length === 0) return;
    setFim(
      paraCampoLocal(
        fimSugerido(
          ini,
          escolhidos.map((s) => s.duracao_min),
        ),
      ),
    );
  }, [fimManual, inicio, servicos]); // eslint-disable-line react-hooks/exhaustive-deps

  const diaDoInicio = ini ? isoBrasilia(ini) : diaPadrao;
  const { data: doDia = [] } = useAgendamentosDoDia(diaDoInicio);

  const itensPrevistos = veic
    ? escolhidos.map((s) => ({
        nome: s.nome,
        preco_estimado: precoPrevisto(
          cad.precos.filter((p) => p.servico_id === s.id),
          veic.tipo,
          s.preco_cadastro,
        ),
      }))
    : [];
  const semPreco = servicosSemPreco(itensPrevistos);

  const avisoRecurso = erroDeRecurso(lavadorId || null, box, cad.regra);
  const conflito =
    ini && fimData && fimData > ini
      ? temConflito(
          doDia.map(paraGrade),
          { inicio: ini, fim: fimData, lavadorId: lavadorId || null, box: box || null },
          cad.regra,
          remarcando?.id,
        )
      : null;

  const salvar = useMutation({
    mutationFn: async () => {
      if (!ini) throw new Error("Informe o dia e a hora do início.");
      if (avisoRecurso) throw new Error(avisoRecurso);
      if (remarcando) {
        const { error } = await supabase.rpc("lr_agenda_remarcar", {
          p_id: remarcando.id,
          p_inicio: ini.toISOString(),
          p_fim: (fimData ? fimData.toISOString() : null) as unknown as string,
          p_lavador_id: (lavadorId || null) as unknown as string,
          p_box: (box.trim() || null) as unknown as string,
        });
        if (error) throw error;
        return;
      }
      if (!veiculoId) throw new Error("Escolha o cliente e o veículo.");
      if (servicos.length === 0) throw new Error("Escolha ao menos um serviço.");
      const { error } = await supabase.rpc("lr_agendar", {
        p_dados: {
          veiculo_id: veiculoId,
          cliente_id: clienteId,
          ...(lavadorId ? { lavador_id: lavadorId } : {}),
          ...(box.trim() ? { box: box.trim() } : {}),
          inicio: ini.toISOString(),
          ...(fimData ? { fim: fimData.toISOString() } : {}),
          servicos,
          ...(obs.trim() ? { observacoes: obs.trim() } : {}),
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(remarcando ? "Agendamento remarcado." : "Agendamento criado.");
      onSalvo();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{remarcando ? "Remarcar agendamento" : "Novo agendamento"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {!remarcando && (
            <>
              <div>
                <Label>Cliente</Label>
                <ClienteCombobox
                  clientes={cad.clientes}
                  value={clienteId}
                  onChange={(id) => {
                    setClienteId(id);
                    setVeiculoId("");
                  }}
                />
              </div>
              <div>
                <Label htmlFor="ag-veiculo">Veículo</Label>
                <Select value={veiculoId} onValueChange={setVeiculoId} disabled={!clienteId}>
                  <SelectTrigger id="ag-veiculo">
                    <SelectValue
                      placeholder={
                        clienteId && veiculosDoCliente.length === 0
                          ? "Cliente sem veículo cadastrado"
                          : "Escolha o veículo"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {veiculosDoCliente.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {formatarIdentificacao(v.tipo, v.identificacao)} · {rotuloTipo(v.tipo)}
                        {` · ${v.fabricante} ${v.modelo}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <fieldset>
                <legend className="mb-1 text-sm font-medium">Serviços previstos</legend>
                <div className="grid gap-1.5 rounded-md border p-2">
                  {cad.servicos.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Nenhum serviço ativo cadastrado.
                    </p>
                  )}
                  {cad.servicos.map((s) => {
                    const preco = veic
                      ? precoPrevisto(
                          cad.precos.filter((p) => p.servico_id === s.id),
                          veic.tipo,
                          s.preco_cadastro,
                        )
                      : undefined;
                    return (
                      <label key={s.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={servicos.includes(s.id)}
                          onCheckedChange={(c) =>
                            setServicos(
                              c ? [...servicos, s.id] : servicos.filter((x) => x !== s.id),
                            )
                          }
                        />
                        <span className="flex-1">{s.nome}</span>
                        <span className="text-xs text-muted-foreground">
                          {s.duracao_min} min ·{" "}
                          {preco === undefined
                            ? "escolha o veículo"
                            : preco === null
                              ? "sem preço cadastrado"
                              : brl(preco)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="ag-lavador">Lavador</Label>
              <Select
                value={lavadorId || "__nenhum"}
                onValueChange={(v) => setLavadorId(v === "__nenhum" ? "" : v)}
              >
                <SelectTrigger id="ag-lavador">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__nenhum">Sem lavador</SelectItem>
                  {cad.lavadores.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="ag-box">Box</Label>
              <Input
                id="ag-box"
                value={box}
                maxLength={40}
                placeholder="Ex.: Box 1"
                onChange={(e) => setBox(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="ag-inicio">Início</Label>
              <Input
                id="ag-inicio"
                type="datetime-local"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ag-fim">Fim</Label>
              <Input
                id="ag-fim"
                type="datetime-local"
                value={fim}
                onChange={(e) => {
                  setFim(e.target.value);
                  setFimManual(true);
                }}
              />
              {!remarcando && !fimManual && escolhidos.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Sugerido pela soma das durações (
                  {escolhidos.reduce((s, x) => s + x.duracao_min, 0)} min). Pode editar.
                </p>
              )}
            </div>
          </div>
          {!remarcando && (
            <div>
              <Label htmlFor="ag-obs">Observações</Label>
              <Textarea
                id="ag-obs"
                rows={2}
                maxLength={500}
                value={obs}
                onChange={(e) => setObs(e.target.value)}
              />
            </div>
          )}
          {avisoRecurso && <p className="text-sm text-destructive">{avisoRecurso}.</p>}
          {conflito && (
            <p className="text-sm text-destructive">
              {conflito === "lavador"
                ? "Este lavador já tem agendamento nesse horário."
                : "Este box já está ocupado nesse horário."}
            </p>
          )}
          {semPreco.length > 0 && (
            <p className="text-sm text-destructive">
              Sem preço cadastrado: {semPreco.join(", ")}. O agendamento é criado, mas a chegada só
              é registrada depois que o preço existir em Serviços e preços.
            </p>
          )}
          {remarcando && (
            <p className="text-xs text-muted-foreground">
              Remarcado, o agendamento volta a “Agendado”: a confirmação era para o horário antigo.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            <CalendarClock className="size-4" /> {remarcando ? "Remarcar" : "Agendar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RegraDeConflito({
  regra,
  onFechar,
  onSalvo,
}: {
  regra: RegraAgenda;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const [lavador, setLavador] = useState(regra.conflitoLavador);
  const [boxC, setBoxC] = useState(regra.conflitoBox);
  const [exigir, setExigir] = useState(regra.exigirRecurso);
  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("lr_agenda_config_salvar", {
        p_conflito_lavador: lavador,
        p_conflito_box: boxC,
        p_exigir_recurso: exigir,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Regra da agenda salva.");
      onSalvo();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Regra de conflito da agenda</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <div className="flex items-center gap-2">
            <Switch id="rg-lav" checked={lavador} onCheckedChange={setLavador} />
            <Label htmlFor="rg-lav">
              Um lavador não pode ter dois agendamentos no mesmo horário
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="rg-box" checked={boxC} onCheckedChange={setBoxC} />
            <Label htmlFor="rg-box">Um box não pode ter dois agendamentos no mesmo horário</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="rg-exigir" checked={exigir} onCheckedChange={setExigir} />
            <Label htmlFor="rg-exigir">Exigir o lavador ou o box em todo agendamento</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Um agendamento pode começar quando outro termina. Cancelado e falta liberam o horário. A
            regra vale para os agendamentos novos e remarcados; os que já existem não mudam. Sem
            exigir lavador ou box, um agendamento sem nenhum dos dois não ocupa horário de ninguém.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
