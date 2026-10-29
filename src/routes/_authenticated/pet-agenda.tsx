import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, ChevronLeft, ChevronRight, Car } from "lucide-react";
import { toast } from "sonner";

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
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useModulosCnae } from "@/lib/cnae";
import { brl, dateBR } from "@/lib/format";
import { isoBrasilia } from "@/lib/fuso";
import {
  FUNCOES_PROFISSIONAL,
  SITUACOES_AGENDA,
  avisoDepoisDoUso,
  avisoDoPacote,
  pacoteQueCobre,
  restamNoPacote,
  type PacoteSaldo,
  descricaoDoPreco,
  duracaoTotal,
  fimDoAtendimento,
  ocupaHorario,
  podeRemarcar,
  precoDoServico,
  proximasSituacoes,
  rotulo,
  temConflito,
  type PetPreco,
} from "@/lib/pet";

export const Route = createFileRoute("/_authenticated/pet-agenda")({
  head: () => ({
    meta: [
      { title: "Agenda do pet shop — EZRA ERP" },
      {
        name: "description",
        content: "Agenda de banho e tosa por profissional, sem horários sobrepostos.",
      },
    ],
  }),
  component: AgendaModulo,
});

const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const somaDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const hora = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const diaExtenso = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

const COR: Record<string, string> = {
  agendado: "bg-secondary",
  confirmado: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
  em_atendimento: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  pronto: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100",
  retirado: "bg-muted text-muted-foreground",
  cancelado: "bg-red-100 text-red-900 line-through dark:bg-red-950 dark:text-red-100",
  faltou: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100",
};

function AgendaModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.petshop) return <ModuloBloqueado modulo="petshop" />;
  return <Agenda />;
}

type Linha = {
  id: string;
  pet_id: string;
  cliente_id: string;
  profissional_id: string;
  inicio: Date;
  fim: Date;
  situacao: string;
  observacoes: string | null;
  taxi_dog: boolean;
  motivo: string | null;
};

function Agenda() {
  const qc = useQueryClient();
  const navegar = useNavigate();
  const { data: session } = useSessionData();
  const roles = session?.roles ?? [];
  const podeAgendar = roles.some((r) =>
    ["administrador", "gestor", "vendedor", "caixa"].includes(r),
  );
  const gestao = roles.some((r) => ["administrador", "gestor"].includes(r));
  const [dia, setDia] = useState(hojeISO);
  const [novo, setNovo] = useState(false);
  const [remarcando, setRemarcando] = useState<Linha | null>(null);
  const [pedindoMotivo, setPedindoMotivo] = useState<{
    ag: Linha;
    para: string;
    rotulo: string;
  } | null>(null);
  const [motivo, setMotivo] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["pet-agenda", dia],
    queryFn: async () => {
      const ini = new Date(`${dia}T00:00:00`);
      const fim = new Date(ini);
      fim.setDate(fim.getDate() + 1);
      const [ags, profs, pets, servicos, precos, clientes, pacs, usos] = await Promise.all([
        supabase
          .from("pet_agendamentos")
          .select("*")
          .gte("inicio", ini.toISOString())
          .lt("inicio", fim.toISOString())
          .order("inicio"),
        supabase.from("pet_profissionais").select("id, nome, funcao, ativo").order("nome"),
        supabase
          .from("pets")
          .select("id, nome, raca, porte, pelagem, cliente_id, ativo")
          .order("nome")
          .limit(2000),
        supabase.from("pet_servicos").select("id, nome, duracao_min, ativo").order("nome"),
        supabase.from("pet_servico_precos").select("id, servico_id, porte, raca, pelagem, preco"),
        supabase
          .from("clientes")
          .select("id, nome")
          .is("deleted_at", null)
          .order("nome")
          .limit(2000),
        supabase
          .from("pet_pacotes")
          .select("id, pet_id, servico_id, situacao, vence_em, quantidade")
          .eq("situacao", "ativo"),
        supabase.from("pet_pacote_usos").select("pacote_id").eq("desfeito", false),
      ]);
      for (const r of [ags, profs, pets, servicos, precos, clientes, pacs, usos])
        if (r.error) throw r.error;
      const usados = new Map<string, number>();
      for (const u of usos.data ?? []) usados.set(u.pacote_id, (usados.get(u.pacote_id) ?? 0) + 1);
      const pacotes: PacoteSaldo[] = (pacs.data ?? []).map((p) => ({
        ...p,
        usados: usados.get(p.id) ?? 0,
      }));
      const ids = (ags.data ?? []).map((a) => a.id);
      const itens = ids.length
        ? await supabase
            .from("pet_agendamento_itens")
            .select("agendamento_id, servico_id, preco_aplicado, duracao_min, preco_avulso")
            .in("agendamento_id", ids)
        : { data: [], error: null };
      if (itens.error) throw itens.error;
      return {
        ags: (ags.data ?? []).map((a) => ({
          ...a,
          inicio: new Date(a.inicio),
          fim: new Date(a.fim),
        })) as Linha[],
        profs: profs.data ?? [],
        pets: pets.data ?? [],
        servicos: servicos.data ?? [],
        precos: (precos.data ?? []).map((p) => ({ ...p, preco: Number(p.preco) })),
        clientes: clientes.data ?? [],
        pacotes,
        itens: itens.data ?? [],
      };
    },
  });
  const ags = useMemo(() => data?.ags ?? [], [data]);
  const profs = useMemo(() => data?.profs ?? [], [data]);

  const nomePet = (id: string) => data?.pets.find((p) => p.id === id)?.nome ?? "Pet";
  const nomeTutor = (id: string) => data?.clientes.find((c) => c.id === id)?.nome ?? "";
  const itensDe = (id: string) => (data?.itens ?? []).filter((i) => i.agendamento_id === id);
  const nomeServico = (id: string) => data?.servicos.find((s) => s.id === id)?.nome ?? "Serviço";

  // colunas: profissionais ativos e os inativos que ainda têm atendimento no dia
  const colunas = useMemo(
    () => profs.filter((p) => p.ativo || ags.some((a) => a.profissional_id === p.id)),
    [profs, ags],
  );

  const atualizar = () => void qc.invalidateQueries({ queryKey: ["pet-agenda"] });

  /** Todos os serviços cobertos por pacote: retira direto, sem caixa. Senão abre a frente de caixa. */
  const retirar = useMutation({
    mutationFn: async (a: Linha) => {
      const itens = itensDe(a.id);
      const { data: cob, error } = await supabase.rpc("pet_agenda_cobertura", {
        p_agendamento_id: a.id,
      });
      if (error) throw error;
      const cobertos = ((cob ?? []) as unknown as unknown[]).length;
      if (cobertos > 0 && cobertos === itens.length) {
        const { data, error: e2 } = await supabase.rpc("pet_agenda_retirar", {
          p_agendamento_id: a.id,
          p_usar_pacote: true,
        });
        if (e2) throw e2;
        return {
          direto: true as const,
          avisos: (data as { avisos?: { pet: string; restam: number }[] } | null)?.avisos ?? [],
        };
      }
      return { direto: false as const, avisos: [] as { pet: string; restam: number }[] };
    },
    onSuccess: (r, a) => {
      if (!r.direto) {
        void navegar({ to: "/frente-caixa", search: { pet: a.id } });
        return;
      }
      toast.success("Atendimento retirado com o banho do pacote.");
      for (const av of r.avisos) {
        const t = avisoDepoisDoUso(av.pet, av.restam);
        if (t) toast.warning(t, { duration: 15000 });
      }
      atualizar();
      void qc.invalidateQueries({ queryKey: ["pet-pacotes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mudar = useMutation({
    mutationFn: async (p: { id: string; para: string; motivo?: string }) => {
      const { error } = await supabase.rpc("pet_agenda_situacao", {
        p_id: p.id,
        p_para: p.para,
        ...(p.motivo ? { p_motivo: p.motivo } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setPedindoMotivo(null);
      setMotivo("");
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Agenda do pet shop"
        description="Banho, tosa e estética por profissional. O mesmo profissional não pode ter dois atendimentos ao mesmo tempo."
        actions={
          podeAgendar ? (
            <Button onClick={() => setNovo(true)}>
              <CalendarPlus className="size-4" /> Novo agendamento
            </Button>
          ) : undefined
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Dia anterior"
          onClick={() => setDia(somaDias(dia, -1))}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Input
          type="date"
          aria-label="Dia da agenda"
          className="w-44"
          value={dia}
          onChange={(e) => e.target.value && setDia(e.target.value)}
        />
        <Button
          variant="outline"
          size="icon"
          aria-label="Próximo dia"
          onClick={() => setDia(somaDias(dia, 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button variant="outline" onClick={() => setDia(hojeISO())}>
          Hoje
        </Button>
        <span className="ml-2 text-sm font-medium capitalize">{diaExtenso(dia)}</span>
      </div>

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : colunas.length === 0 ? (
        <EmptyState
          title="Cadastre os profissionais primeiro"
          description="A agenda é organizada por profissional (banhista, tosador...). Cadastre-os em Profissionais."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {colunas.map((pf) => {
            const doDia = ags.filter((a) => a.profissional_id === pf.id);
            return (
              <section key={pf.id} className="panel p-3" aria-label={`Agenda de ${pf.nome}`}>
                <h2 className="mb-2 font-display text-base font-semibold">
                  {pf.nome}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {rotulo(FUNCOES_PROFISSIONAL, pf.funcao)}
                  </span>
                  {!pf.ativo && (
                    <Badge variant="outline" className="ml-2">
                      Inativo
                    </Badge>
                  )}
                </h2>
                {doDia.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">Dia livre.</p>
                ) : (
                  <ul className="space-y-2">
                    {doDia.map((a) => {
                      const itens = itensDe(a.id);
                      const total = itens.reduce((s, i) => s + Number(i.preco_aplicado), 0);
                      const passos = proximasSituacoes(a.situacao);
                      return (
                        <li
                          key={a.id}
                          className={`rounded border p-2 text-sm ${COR[a.situacao] ?? ""}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <strong>
                                {hora(a.inicio)}–{hora(a.fim)}
                              </strong>{" "}
                              {nomePet(a.pet_id)}
                              <span className="block text-xs opacity-80">
                                {nomeTutor(a.cliente_id)}
                              </span>
                            </div>
                            <Badge variant="outline">{rotulo(SITUACOES_AGENDA, a.situacao)}</Badge>
                          </div>
                          <p className="mt-1 text-xs">
                            {itens.map((i) => nomeServico(i.servico_id)).join(" + ")} · {brl(total)}
                            {a.taxi_dog && (
                              <span className="ml-2 inline-flex items-center gap-1">
                                <Car className="size-3" /> táxi dog
                              </span>
                            )}
                          </p>
                          {ocupaHorario(a.situacao) &&
                            a.situacao !== "retirado" &&
                            itens.map((i) => {
                              const dia = isoBrasilia(a.inicio);
                              const pc = pacoteQueCobre(
                                data?.pacotes ?? [],
                                a.pet_id,
                                i.servico_id,
                                dia,
                              );
                              if (!pc) return null;
                              const restam = restamNoPacote(pc);
                              const aviso = avisoDoPacote(restam);
                              return (
                                <p
                                  key={i.servico_id}
                                  className={`mt-1 rounded px-1 text-xs ${aviso ? "bg-amber-200 font-semibold text-amber-950" : ""}`}
                                >
                                  Pacote: restam {restam} (vence {dateBR(pc.vence_em)}).{" "}
                                  {aviso ?? ""}
                                </p>
                              );
                            })}
                          {a.observacoes && <p className="mt-1 text-xs italic">{a.observacoes}</p>}
                          {a.motivo && <p className="mt-1 text-xs">Motivo: {a.motivo}</p>}
                          {podeAgendar &&
                            (passos.length > 0 ||
                              podeRemarcar(a.situacao) ||
                              a.situacao === "pronto") && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {passos.map((p) => (
                                  <Button
                                    key={p.para}
                                    size="sm"
                                    variant={p.motivo ? "outline" : "default"}
                                    disabled={mudar.isPending}
                                    onClick={() =>
                                      p.motivo
                                        ? setPedindoMotivo({
                                            ag: a,
                                            para: p.para,
                                            rotulo: p.rotulo,
                                          })
                                        : mudar.mutate({ id: a.id, para: p.para })
                                    }
                                  >
                                    {p.rotulo}
                                  </Button>
                                ))}
                                {a.situacao === "pronto" && (
                                  <Button
                                    size="sm"
                                    disabled={retirar.isPending}
                                    onClick={() => retirar.mutate(a)}
                                  >
                                    Retirar e cobrar
                                  </Button>
                                )}
                                {podeRemarcar(a.situacao) && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setRemarcando(a)}
                                  >
                                    Remarcar
                                  </Button>
                                )}
                              </div>
                            )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {novo && data && (
        <NovoAgendamento
          dia={dia}
          dados={data}
          gestao={gestao}
          onFechar={() => setNovo(false)}
          onCriado={() => {
            setNovo(false);
            atualizar();
          }}
        />
      )}

      {remarcando && data && (
        <RemarcarDialog
          ag={remarcando}
          profs={profs.filter((p) => p.ativo)}
          ags={ags}
          onFechar={() => setRemarcando(null)}
          onFeito={() => {
            setRemarcando(null);
            atualizar();
          }}
        />
      )}

      <Dialog open={!!pedindoMotivo} onOpenChange={(o) => !o && setPedindoMotivo(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{pedindoMotivo?.rotulo}</DialogTitle>
          </DialogHeader>
          <Label htmlFor="ag-motivo">Motivo</Label>
          <Input id="ag-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPedindoMotivo(null)}>
              Voltar
            </Button>
            <Button
              disabled={mudar.isPending}
              onClick={() => {
                if (!motivo.trim()) {
                  toast.error("Informe o motivo.");
                  return;
                }
                mudar.mutate({
                  id: pedindoMotivo!.ag.id,
                  para: pedindoMotivo!.para,
                  motivo: motivo.trim(),
                });
              }}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type Dados = {
  ags: Linha[];
  profs: { id: string; nome: string; funcao: string; ativo: boolean }[];
  pets: {
    id: string;
    nome: string;
    raca: string | null;
    porte: string | null;
    pelagem: string | null;
    cliente_id: string;
    ativo: boolean;
  }[];
  servicos: { id: string; nome: string; duracao_min: number; ativo: boolean }[];
  precos: (PetPreco & { servico_id: string })[];
  clientes: { id: string; nome: string }[];
  pacotes: PacoteSaldo[];
};

function NovoAgendamento({
  dia,
  dados,
  gestao,
  onFechar,
  onCriado,
}: {
  dia: string;
  dados: Dados;
  gestao: boolean;
  onFechar: () => void;
  onCriado: () => void;
}) {
  const [petId, setPetId] = useState("");
  const [profId, setProfId] = useState("");
  const [data, setData] = useState(dia);
  const [horaIni, setHoraIni] = useState("09:00");
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const [avulsos, setAvulsos] = useState<Record<string, string>>({});
  const [obs, setObs] = useState("");
  const [taxi, setTaxi] = useState(false);

  const pet = dados.pets.find((p) => p.id === petId);
  const servicos = dados.servicos.filter((s) => s.ativo);
  const precoDe = (servicoId: string) =>
    pet
      ? precoDoServico(
          dados.precos.filter((p) => p.servico_id === servicoId),
          pet,
        )
      : null;

  const selecionados = servicos.filter((s) => escolhidos.includes(s.id));
  const duracao = duracaoTotal(selecionados);
  const inicio = new Date(`${data}T${horaIni}:00`);
  const valido = !Number.isNaN(inicio.getTime());
  const fim = valido ? fimDoAtendimento(inicio, duracao) : null;
  const total = selecionados.reduce((s, sv) => {
    const p = precoDe(sv.id);
    return s + (p ? p.preco : Number((avulsos[sv.id] ?? "0").replace(",", ".")) || 0);
  }, 0);
  const conflito =
    valido && fim && profId && duracao > 0 && data === dia
      ? temConflito(dados.ags, profId, inicio, fim)
      : false;

  const criar = useMutation({
    mutationFn: async () => {
      if (!petId) throw new Error("Escolha o pet.");
      if (!profId) throw new Error("Escolha o profissional.");
      if (!valido) throw new Error("Informe o dia e a hora.");
      if (selecionados.length === 0) throw new Error("Escolha ao menos um serviço.");
      const servicosEnvio = selecionados.map((s) => {
        if (precoDe(s.id)) return { servico_id: s.id };
        const v = Number((avulsos[s.id] ?? "").replace(",", "."));
        if (!gestao || !Number.isFinite(v) || (avulsos[s.id] ?? "").trim() === "")
          throw new Error(`"${s.nome}" não tem preço para este pet.`);
        return { servico_id: s.id, preco_avulso: v };
      });
      const { error } = await supabase.rpc("pet_agendar", {
        p_dados: {
          pet_id: petId,
          profissional_id: profId,
          inicio: inicio.toISOString(),
          servicos: servicosEnvio,
          observacoes: obs.trim() || null,
          taxi_dog: taxi,
        } as unknown as Json,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Atendimento agendado.");
      onCriado();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo agendamento</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="na-pet">Pet</Label>
            <Select value={petId} onValueChange={setPetId}>
              <SelectTrigger id="na-pet">
                <SelectValue placeholder="Escolha o pet" />
              </SelectTrigger>
              <SelectContent>
                {dados.pets
                  .filter((p) => p.ativo)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome}
                      {p.raca ? ` — ${p.raca}` : ""} (
                      {dados.clientes.find((c) => c.id === p.cliente_id)?.nome ?? "tutor"})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="na-prof">Profissional</Label>
            <Select value={profId} onValueChange={setProfId}>
              <SelectTrigger id="na-prof">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                {dados.profs
                  .filter((p) => p.ativo)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="na-data">Dia</Label>
              <Input
                id="na-data"
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="na-hora">Hora</Label>
              <Input
                id="na-hora"
                type="time"
                value={horaIni}
                onChange={(e) => setHoraIni(e.target.value)}
              />
            </div>
          </div>

          <div className="sm:col-span-2">
            <Label>Serviços</Label>
            {!pet && (
              <p className="text-xs text-muted-foreground">Escolha o pet para ver os preços.</p>
            )}
            <ul className="mt-1 space-y-1">
              {servicos.map((s) => {
                const p = precoDe(s.id);
                const marcado = escolhidos.includes(s.id);
                return (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center gap-2 rounded border p-2 text-sm"
                  >
                    <Checkbox
                      id={`na-sv-${s.id}`}
                      checked={marcado}
                      onCheckedChange={(v) =>
                        setEscolhidos(
                          v ? [...escolhidos, s.id] : escolhidos.filter((x) => x !== s.id),
                        )
                      }
                    />
                    <Label htmlFor={`na-sv-${s.id}`} className="flex-1">
                      {s.nome}{" "}
                      <span className="text-xs text-muted-foreground">({s.duracao_min} min)</span>
                    </Label>
                    {pet &&
                      (() => {
                        const pc = pacoteQueCobre(dados.pacotes, pet.id, s.id, data);
                        if (!pc) return null;
                        const restam = restamNoPacote(pc);
                        const aviso = avisoDoPacote(restam);
                        return (
                          <span
                            className={`w-full text-xs ${aviso ? "font-semibold text-amber-700" : "text-muted-foreground"}`}
                          >
                            Pacote ativo: restam {restam}, vence {dateBR(pc.vence_em)}.{" "}
                            {aviso ?? ""}
                          </span>
                        );
                      })()}
                    {pet &&
                      (p ? (
                        <span title={descricaoDoPreco(p)}>{brl(p.preco)}</span>
                      ) : gestao ? (
                        <Input
                          className="h-8 w-28"
                          inputMode="decimal"
                          placeholder="Preço avulso"
                          aria-label={`Preço avulso de ${s.nome}`}
                          value={avulsos[s.id] ?? ""}
                          onChange={(e) => setAvulsos({ ...avulsos, [s.id]: e.target.value })}
                        />
                      ) : (
                        <span className="text-xs text-destructive">sem preço para este pet</span>
                      ))}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex items-center gap-2">
            <Switch id="na-taxi" checked={taxi} onCheckedChange={setTaxi} />
            <Label htmlFor="na-taxi">Táxi dog</Label>
          </div>
          <div>
            <Label htmlFor="na-obs">Observações</Label>
            <Input id="na-obs" value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
        </div>

        <div className="rounded border p-2 text-sm">
          {duracao > 0 && fim ? (
            <>
              Duração <strong>{duracao} min</strong> · termina às <strong>{hora(fim)}</strong> ·
              total <strong>{brl(total)}</strong>
            </>
          ) : (
            "Escolha os serviços para ver duração e total."
          )}
          {conflito && (
            <p className="mt-1 text-destructive">
              Este profissional já tem atendimento neste horário.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => criar.mutate()} disabled={criar.isPending}>
            Agendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemarcarDialog({
  ag,
  profs,
  ags,
  onFechar,
  onFeito,
}: {
  ag: Linha;
  profs: { id: string; nome: string }[];
  ags: Linha[];
  onFechar: () => void;
  onFeito: () => void;
}) {
  const ini0 = ag.inicio;
  const [data, setData] = useState(
    `${ini0.getFullYear()}-${String(ini0.getMonth() + 1).padStart(2, "0")}-${String(ini0.getDate()).padStart(2, "0")}`,
  );
  const [horaIni, setHoraIni] = useState(
    `${String(ini0.getHours()).padStart(2, "0")}:${String(ini0.getMinutes()).padStart(2, "0")}`,
  );
  const [profId, setProfId] = useState(ag.profissional_id);

  const salvar = useMutation({
    mutationFn: async () => {
      const inicio = new Date(`${data}T${horaIni}:00`);
      if (Number.isNaN(inicio.getTime())) throw new Error("Informe o dia e a hora.");
      const { error } = await supabase.rpc("pet_reagendar", {
        p_id: ag.id,
        p_inicio: inicio.toISOString(),
        p_profissional_id: profId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Atendimento remarcado.");
      onFeito();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const ocupados = ags.filter((a) => a.id !== ag.id && ocupaHorario(a.situacao)).length;

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Remarcar atendimento</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="rm-data">Dia</Label>
              <Input
                id="rm-data"
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="rm-hora">Hora</Label>
              <Input
                id="rm-hora"
                type="time"
                value={horaIni}
                onChange={(e) => setHoraIni(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="rm-prof">Profissional</Label>
            <Select value={profId} onValueChange={setProfId}>
              <SelectTrigger id="rm-prof">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {profs.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            A duração e os preços combinados não mudam. {ocupados} outro(s) atendimento(s) neste
            dia.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            Remarcar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
