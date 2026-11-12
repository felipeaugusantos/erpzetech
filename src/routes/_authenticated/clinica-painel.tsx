import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PawPrint, Receipt, Stethoscope, UserPlus } from "lucide-react";
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
import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { SeletorPeriodo } from "@/components/app/SeletorPeriodo";
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { brl, num } from "@/lib/format";
import { usePeriodo } from "@/lib/periodo";
import { ESPECIES, rotulo } from "@/lib/pet";

export const Route = createFileRoute("/_authenticated/clinica-painel")({
  head: () => ({
    meta: [
      { title: "Painel da clínica — ERP Ze Tech" },
      { name: "description", content: "Atendimentos, pacientes e receita da clínica veterinária." },
      { property: "og:title", content: "Painel da clínica — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Gráficos de atendimentos, pacientes e receita da clínica.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PainelModulo,
});

type Painel = {
  dias: { dia: string; atendimentos: number; pacientes: number; novos: number; receita: number }[];
  atendimentos: number;
  pacientes: number;
  novos: number;
  receita: number;
  especies: { especie: string; pacientes: number }[];
};

function PainelModulo() {
  const modulos = useModulosCnae();
  const { data: sessao } = useSessionData();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  const gestao = (sessao?.roles ?? []).some((r) => r === "administrador" || r === "gestor");
  if (!gestao)
    return (
      <EmptyState
        title="Painel só para a gestão"
        description="O painel da clínica mostra receita e fica com administrador e gestor."
      />
    );
  return <PainelClinica />;
}

const diaCurto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const eixo = { fontSize: 11, fill: "var(--muted-foreground)" };

function PainelClinica() {
  const { periodo, setPeriodo } = usePeriodo();
  const valido = /^\d{4}-\d{2}-\d{2}$/.test(periodo.de) && /^\d{4}-\d{2}-\d{2}$/.test(periodo.ate);
  const { data, isLoading, error } = useQuery({
    queryKey: ["clinica-painel", periodo.de, periodo.ate],
    enabled: valido,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_painel", {
        p_de: periodo.de,
        p_ate: periodo.ate,
      });
      if (error) throw error;
      return data as unknown as Painel;
    },
  });

  const ticket = data && data.atendimentos ? data.receita / data.atendimentos : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Painel da clínica"
        description="Atendimentos, pacientes e receita da clínica veterinária."
      />
      <SeletorPeriodo periodo={periodo} aoMudar={setPeriodo} />

      {error ? (
        <EmptyState title="Não foi possível abrir o painel" description={(error as Error).message} />
      ) : isLoading || !data ? (
        <div className="panel h-64 animate-pulse" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Atendimentos"
              value={num(data.atendimentos, 0)}
              icon={Stethoscope}
              tone="accent"
            />
            <StatCard
              label="Pacientes atendidos"
              value={num(data.pacientes, 0)}
              icon={PawPrint}
            />
            <StatCard
              label="Pacientes novos"
              value={num(data.novos, 0)}
              hint="Primeira consulta no período"
              icon={UserPlus}
              tone="success"
            />
            <StatCard
              label="Receita"
              value={brl(data.receita)}
              hint={`Ticket médio ${brl(ticket)}`}
              icon={Receipt}
              tone="success"
            />
          </div>

          <div className="panel p-4">
            <h2 className="font-display text-sm font-semibold">Receita por dia</h2>
            <div className="mt-3 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.dias} margin={{ left: 8, right: 8, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="dia" tickFormatter={diaCurto} tick={eixo} />
                  <YAxis
                    tick={eixo}
                    width={70}
                    tickFormatter={(v: number) => brl(v).replace(",00", "")}
                  />
                  <Tooltip
                    content={<DashboardChartTooltip moeda labelFormatter={(l) => diaCurto(String(l))} />}
                  />
                  <Line
                    type="monotone"
                    dataKey="receita"
                    name="Receita"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    dot={data.dias.length <= 7}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <div className="panel p-4">
              <h2 className="font-display text-sm font-semibold">Atendimentos e pacientes por dia</h2>
              <div className="mt-3 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.dias} margin={{ left: 0, right: 8, top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="dia" tickFormatter={diaCurto} tick={eixo} />
                    <YAxis tick={eixo} allowDecimals={false} width={32} />
                    <Tooltip
                      cursor={{ fill: "var(--muted)" }}
                      content={<DashboardChartTooltip labelFormatter={(l) => diaCurto(String(l))} />}
                    />
                    <Bar
                      dataKey="atendimentos"
                      name="Atendimentos"
                      fill="var(--primary)"
                      radius={[6, 6, 0, 0]}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="novos"
                      name="Pacientes novos"
                      fill="var(--accent)"
                      radius={[6, 6, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="panel p-4">
              <h2 className="font-display text-sm font-semibold">Pacientes por espécie</h2>
              {data.especies.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">Nenhum atendimento no período.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {data.especies.map((e) => {
                    const pct = data.pacientes ? (e.pacientes / data.pacientes) * 100 : 0;
                    return (
                      <li key={e.especie} className="text-sm">
                        <div className="flex justify-between">
                          <span>{rotulo(ESPECIES, e.especie)}</span>
                          <span className="font-semibold">{e.pacientes}</span>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-muted">
                          <div
                            className="h-2 rounded-full bg-primary"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Receita: serviços dos agendamentos ligados às consultas do período, sem faltas nem
            cancelamentos.
          </p>
        </>
      )}
    </div>
  );
}
