import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  CalendarDays,
  Percent,
  Receipt,
  Repeat,
  SlidersHorizontal,
  Syringe,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DashboardChartTooltip } from "@/components/app/DashboardChartTooltip";

import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PersonalizarDashboardDialog } from "@/components/app/PersonalizarDashboardDialog";
import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import {
  aFrente,
  agendaDoDia,
  atendimentosPorDia,
  clientesSemRetorno,
  faltas,
  faturamento,
  servicosMaisVendidos,
  somaDiasISO,
  type AgendamentoDash,
} from "@/lib/dashboard-pet";
import {
  PECAS_DASHBOARD_PET,
  aplicarDashboard,
  type PecaDashboard,
} from "@/lib/dashboard-personalizado";
import { useDashboardPersonalizado } from "@/lib/dashboard-personalizado-dados";
import { brl, num } from "@/lib/format";
import { isoBrasilia } from "@/lib/fuso";
import { ATALHOS_PERIODO, atalhoAtivo, periodoDoAtalho, usePeriodo } from "@/lib/periodo";
import { cn } from "@/lib/utils";
import { dateBR } from "@/lib/format";

type LinhaAgenda = {
  id: string;
  inicio: string;
  situacao: string;
  cliente_id: string;
  pets: { nome: string } | null;
  pet_profissionais: { nome: string } | null;
  pet_agendamento_itens: { preco_aplicado: number; pet_servicos: { nome: string } | null }[] | null;
};

const ROTULO_SITUACAO: Record<string, string> = {
  agendado: "Agendado",
  confirmado: "Confirmado",
  em_atendimento: "Em atendimento",
  pronto: "Pronto",
  retirado: "Retirado",
};

const hora = (inicio: string) =>
  new Date(inicio).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

/**
 * Dashboard da clínica veterinária e do pet shop: o dia da agenda, o faturamento dos atendimentos, faltas, retorno dos clientes, reforços de
 * vacina e as contas a receber e a pagar. Sem pedidos, orçamentos, entregas, estoque nem notas fiscais, que ficam nas próprias telas.
 */
export function DashboardPet({ clinica }: { clinica: boolean }) {
  const hoje = isoBrasilia();
  const { periodo, setPeriodo, setDe, setAte } = usePeriodo();
  // 12 meses para o retorno dos clientes, e mais para trás se o período escolhido começar antes disso
  const umAno = somaDiasISO(hoje, -365);
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(periodo.de) && periodo.de < umAno ? periodo.de : umAno;

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-pet", desde],
    queryFn: async () => {
      // a agenda vem em páginas (o banco limita cada resposta): nenhum agendamento do período fica de fora
      const linhas: LinhaAgenda[] = [];
      for (let pagina = 0; pagina < 40; pagina++) {
        const { data: lote, error } = await supabase
          .from("pet_agendamentos")
          .select(
            "id, inicio, situacao, cliente_id, pets(nome), pet_profissionais(nome), pet_agendamento_itens(preco_aplicado, pet_servicos(nome))",
          )
          .gte("inicio", `${desde}T00:00:00-03:00`)
          .order("inicio", { ascending: false })
          .order("id")
          .range(pagina * 1000, pagina * 1000 + 999);
        if (error) throw error;
        linhas.push(...((lote ?? []) as unknown as LinhaAgenda[]));
        if ((lote ?? []).length < 1000) break;
      }
      const [receber, pagar] = await Promise.all([
        supabase.from("contas_receber").select("valor, valor_recebido, situacao, vencimento"),
        supabase.from("contas_pagar").select("valor, valor_pago, situacao, vencimento"),
      ]);
      return { linhas, receber: receber.data ?? [], pagar: pagar.data ?? [] };
    },
  });

  // reforços de vacina: só quem tem a clínica e o perfil de gestão ou recepção (o banco confere; sem permissão, o cartão some)
  const reforcos = useQuery({
    queryKey: ["dashboard-pet-reforcos"],
    enabled: clinica,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_reforcos_pendentes", {
        p_janela: 15,
        p_atraso: 180,
      });
      if (error) return null;
      return (data ?? []) as unknown as { dias: number }[];
    },
  });

  // personalização da empresa: administrador e gestor escolhem o que o dashboard mostra (o padrão vale sem configuração)
  const { data: sessao } = useSessionData();
  const gestao = (sessao?.roles ?? []).some((r) => r === "administrador" || r === "gestor");
  const { data: configDashboard } = useDashboardPersonalizado("pet");
  const [personalizando, setPersonalizando] = useState(false);
  // só entram as peças que a pessoa já pode ver: reforços de vacina dependem da clínica e do perfil
  const disponiveis = useMemo<PecaDashboard[]>(
    () =>
      PECAS_DASHBOARD_PET.filter(
        (p) => p.id !== "reforcos-vacina" || (clinica && Boolean(reforcos.data)),
      ),
    [clinica, reforcos.data],
  );

  if (isLoading || !data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="panel h-28 animate-pulse" />
        ))}
      </div>
    );
  }

  const ags: AgendamentoDash[] = data.linhas.map((l) => ({
    id: l.id,
    inicio: l.inicio,
    situacao: l.situacao,
    cliente_id: l.cliente_id,
    itens: (l.pet_agendamento_itens ?? []).map((i) => ({
      preco_aplicado: Number(i.preco_aplicado),
      servico: i.pet_servicos?.nome ?? "Serviço",
    })),
  }));

  const dia = agendaDoDia(ags, hoje);
  const fat = faturamento(ags, periodo.de, periodo.ate);
  const fal = faltas(ags, periodo.de, periodo.ate);
  const adiante = aFrente(ags, new Date());
  const retorno = clientesSemRetorno(ags, hoje, 90);
  const top = servicosMaisVendidos(ags, periodo.de, periodo.ate, 5);
  const porDia = atendimentosPorDia(ags, periodo.de, periodo.ate);

  const abertoReceber = data.receber.filter((c) => ["aberto", "parcial"].includes(c.situacao));
  const abertoPagar = data.pagar.filter((c) => ["aberto", "parcial"].includes(c.situacao));
  const saldoReceber = abertoReceber.reduce(
    (s, c) => s + Number(c.valor) - Number(c.valor_recebido),
    0,
  );
  const saldoPagar = abertoPagar.reduce((s, c) => s + Number(c.valor) - Number(c.valor_pago), 0);

  const agendaHoje = data.linhas
    .filter((l) => isoBrasilia(new Date(l.inicio)) === hoje)
    .filter((l) => l.situacao !== "cancelado" && l.situacao !== "faltou")
    .sort((a, b) => a.inicio.localeCompare(b.inicio));

  const reforcosAtrasados = (reforcos.data ?? []).filter((r) => r.dias < 0).length;

  const visiveis = aplicarDashboard(disponiveis, configDashboard);
  const cartoes: Record<string, ReactNode> = {
    "atendimentos-hoje": (
      <StatCard
        label="Atendimentos hoje"
        value={num(dia.total, 0)}
        icon={CalendarDays}
        tone="accent"
        hint={`${dia.concluidos} concluídos · ${dia.emAtendimento} em atendimento · ${dia.aguardando} aguardando`}
      />
    ),
    faturamento: (
      <StatCard
        label="Faturamento no período"
        value={brl(fat.total)}
        icon={Receipt}
        tone="success"
        hint={`${fat.atendimentos} atendimentos · ticket médio ${brl(fat.ticket)}`}
      />
    ),
    faltas: (
      <StatCard
        label="Faltas e cancelamentos"
        value={`${num(fal.taxa, 1)}%`}
        icon={Percent}
        tone={fal.taxa >= 20 ? "warning" : "default"}
        hint={`${fal.faltas} faltas · ${fal.cancelados} cancelamentos de ${fal.total} marcados`}
      />
    ),
    "marcados-a-frente": (
      <StatCard
        label="Marcados à frente"
        value={num(adiante.total, 0)}
        icon={CalendarClock}
        hint={`${adiante.proximosDias} nos próximos 7 dias`}
      />
    ),
    "sem-retorno": (
      <StatCard
        label="Clientes sem retorno há 90 dias"
        value={num(retorno.semRetorno, 0)}
        icon={Repeat}
        tone={retorno.semRetorno > 0 ? "warning" : "default"}
        hint={`de ${retorno.ativos} clientes atendidos nos últimos 12 meses`}
      />
    ),
    "reforcos-vacina": reforcos.data ? (
      <StatCard
        label="Reforços de vacina"
        value={num(reforcos.data.length, 0)}
        icon={Syringe}
        tone={reforcosAtrasados > 0 ? "warning" : "default"}
        hint={`${reforcosAtrasados} atrasados · a vencer em 15 dias`}
      />
    ) : null,
    "a-receber": (
      <StatCard
        label="A receber em aberto"
        value={brl(saldoReceber)}
        icon={Wallet}
        tone="success"
        hint={`${abertoReceber.filter((c) => c.vencimento < hoje).length} vencidas`}
      />
    ),
    "a-pagar": (
      <StatCard
        label="A pagar em aberto"
        value={brl(saldoPagar)}
        icon={Wallet}
        tone="danger"
        hint={`${abertoPagar.filter((c) => c.vencimento < hoje).length} vencidas`}
      />
    ),
  };
  const paineis: Record<string, { largura: string; conteudo: ReactNode }> = {
    "grafico-atendimentos": {
      largura: "lg:col-span-2",
      conteudo: (
        <div className="panel p-4">
          <h2 className="font-display text-sm font-semibold">Faturamento dos atendimentos</h2>
          <p className="text-xs text-muted-foreground">Atendimentos concluídos no período</p>
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={porDia} margin={{ top: 12, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="dia" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(d: string) => d.slice(8, 10) + "/" + d.slice(5, 7)} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={70} tickFormatter={(v: number) => brl(v)} />
                <Tooltip content={<DashboardChartTooltip moeda />} labelFormatter={(d) => dateBR(String(d))} cursor={{ stroke: "var(--border)", strokeDasharray: "4 4" }} />
                <Line type="monotone" dataKey="faturamento" name="Faturamento" stroke="var(--chart-1)" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <h3 className="mt-4 font-display text-sm font-semibold">Atendimentos por dia</h3>
          <div className="mt-2 h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porDia}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="dia" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(d: string) => d.slice(8, 10) + "/" + d.slice(5, 7)} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip content={<DashboardChartTooltip />} labelFormatter={(d) => dateBR(String(d))} cursor={{ fill: "var(--secondary)", fillOpacity: 0.6 }} />
                <Bar dataKey="atendimentos" name="Atendimentos" fill="var(--chart-2)" radius={[8, 8, 0, 0]} maxBarSize={36} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ),
    },
    "servicos-top": {
      largura: "",
      conteudo: (
        <div className="panel p-4">
          <h2 className="font-display text-sm font-semibold">Serviços que mais faturaram</h2>
          {top.length === 0 ? (
            <EmptyState
              className="mt-4 border-0 shadow-none"
              title="Nenhum atendimento concluído no período."
            />
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {top.map((t) => (
                <li key={t.servico} className="flex items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{t.servico}</span>
                  <span className="text-xs text-muted-foreground">{t.quantidade}×</span>
                  <span className="text-numeric font-medium">{brl(t.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ),
    },
    "agenda-hoje": {
      largura: "lg:col-span-3",
      conteudo: (
        <div className="panel p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-sm font-semibold">Agenda de hoje</h2>
            <Button asChild variant="outline" size="sm">
              <Link to="/pet-agenda">Abrir a agenda</Link>
            </Button>
          </div>
          {agendaHoje.length === 0 ? (
            <EmptyState className="mt-4 border-0 shadow-none" title="Nada marcado para hoje." />
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {agendaHoje.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="text-numeric w-14 font-medium">{hora(l.inicio)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {l.pets?.nome ?? "Pet"}
                    {l.pet_profissionais?.nome ? ` · ${l.pet_profissionais.nome}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {(l.pet_agendamento_itens ?? [])
                      .map((i) => i.pet_servicos?.nome)
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                  <Badge variant="outline">{ROTULO_SITUACAO[l.situacao] ?? l.situacao}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      ),
    },
  };
  const cartoesVisiveis = visiveis.filter((p) => p.secao === "indicadores" && cartoes[p.id]);
  const paineisVisiveis = visiveis.filter((p) => p.secao === "paineis" && paineis[p.id]);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="A agenda do dia, o faturamento dos atendimentos, as faltas, o retorno dos clientes e as contas a receber e a pagar."
        actions={
          <div className="flex gap-2">
            {gestao && (
              <Button variant="outline" size="sm" onClick={() => setPersonalizando(true)}>
                <SlidersHorizontal className="size-4" /> Personalizar
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link to="/pet-agenda">Agenda</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/fluxo-caixa">Fluxo de caixa</Link>
            </Button>
          </div>
        }
      />

      <div className="panel mb-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-sm font-semibold">Período de referência</h2>
          <div role="group" aria-label="Atalhos de período" className="inline-flex flex-wrap gap-1 rounded-lg bg-secondary p-1">
            {ATALHOS_PERIODO.map((a) => {
              const ativo = atalhoAtivo(periodo) === a.id;
              return (
                <Button
                  key={a.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-pressed={ativo}
                  onClick={() => setPeriodo(periodoDoAtalho(a.id))}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    ativo ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground",
                  )}
                >
                  {a.rotulo}
                </Button>
              );
            })}
            <span className={cn("rounded-md px-3 py-1.5 text-xs font-medium", atalhoAtivo(periodo) === null ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}>
              Personalizado
            </span>
          </div>
        </div>
        <div className="mt-3 grid max-w-md grid-cols-2 gap-3">
          <div>
            <Label>De</Label>
            <Input type="date" value={periodo.de} onChange={(e) => setDe(e.target.value)} />
          </div>
          <div>
            <Label>Até</Label>
            <Input type="date" value={periodo.ate} onChange={(e) => setAte(e.target.value)} />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          O período vale para o faturamento, as faltas e o ranking de serviços.
        </p>
      </div>

      {cartoesVisiveis.length === 0 && paineisVisiveis.length === 0 && (
        <EmptyState
          title="Nenhum cartão ou painel ligado"
          description={
            gestao
              ? "Use o botão Personalizar para escolher o que o dashboard mostra."
              : "A administração da empresa escolheu não mostrar nada aqui."
          }
        />
      )}

      {cartoesVisiveis.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cartoesVisiveis.map((p) => (
            <div key={p.id} className="contents">
              {cartoes[p.id]}
            </div>
          ))}
        </div>
      )}

      {paineisVisiveis.length > 0 && (
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {paineisVisiveis.map((p) => (
            <div key={p.id} className={`${paineis[p.id]?.largura ?? ""} [&>.panel]:h-full`}>
              {paineis[p.id]?.conteudo}
            </div>
          ))}
        </div>
      )}

      {gestao && (
        <PersonalizarDashboardDialog
          aberto={personalizando}
          aoMudar={setPersonalizando}
          disponiveis={disponiveis}
          config={configDashboard ?? null}
        />
      )}
    </>
  );
}
