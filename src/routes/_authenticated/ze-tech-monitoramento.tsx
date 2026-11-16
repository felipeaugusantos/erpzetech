import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, Bug, UserX, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { assinaturaLegada } from "@/lib/assinatura-legada";
import { dateBR, dateTimeBR, num } from "@/lib/format";
import { usePeriodo } from "@/lib/periodo";
import { useSaasOperador } from "@/lib/saas";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { SeletorPeriodo } from "@/components/app/SeletorPeriodo";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/ze-tech-monitoramento")({
  head: () => ({
    meta: [
      { title: "Monitoramento de erro e uso — EZRA" },
      {
        name: "description",
        content:
          "Painel gerencial da equipe EZRA: erros do sistema e uso de cada cliente, por período.",
      },
      { property: "og:title", content: "Monitoramento de erro e uso — EZRA" },
      {
        property: "og:description",
        content: "Erros do sistema e uso de cada cliente do EZRA ERP, por período.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MonitoramentoZeTech,
});

function MonitoramentoZeTech() {
  const { data: operador, isLoading: carregandoAcesso } = useSaasOperador();
  const { periodo, setPeriodo } = usePeriodo();
  const habilitado = operador === true;

  const { data: resumo, isLoading: carregandoResumo } = useQuery({
    queryKey: ["saas-monitoramento-resumo", periodo.de, periodo.ate],
    enabled: habilitado,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await assinaturaLegada.rpc("saas_monitoramento_resumo", {
        p_de: periodo.de,
        p_ate: periodo.ate,
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const { data: dias = [], isLoading: carregandoDias } = useQuery({
    queryKey: ["saas-monitoramento-dia", periodo.de, periodo.ate],
    enabled: habilitado,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await assinaturaLegada.rpc("saas_monitoramento_dia", {
        p_de: periodo.de,
        p_ate: periodo.ate,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: clientes = [], isLoading: carregandoClientes } = useQuery({
    queryKey: ["saas-monitoramento-uso-cliente", periodo.de, periodo.ate],
    enabled: habilitado,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await assinaturaLegada.rpc("saas_monitoramento_uso_cliente", {
        p_de: periodo.de,
        p_ate: periodo.ate,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: topErros = [] } = useQuery({
    queryKey: ["saas-monitoramento-top-erros", periodo.de, periodo.ate],
    enabled: habilitado,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await assinaturaLegada.rpc("saas_monitoramento_top_erros", {
        p_de: periodo.de,
        p_ate: periodo.ate,
        p_limite: 10,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (carregandoAcesso) {
    return <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>;
  }
  if (operador !== true) {
    return (
      <EmptyState
        title="Área exclusiva da equipe EZRA."
        description="Entre com um acesso da equipe para ver o monitoramento de erro e uso."
      />
    );
  }

  const carregando = carregandoResumo || carregandoDias || carregandoClientes;
  const diasGrafico = dias.map((d) => ({
    ...d,
    rotulo: dateBR(d.dia).slice(0, 5),
  }));

  return (
    <div>
      <PageHeader
        title="Monitoramento de erro e uso"
        description="Saúde do sistema (erros do navegador e do servidor) e adoção (quem entra e opera), por período. Detalhe de cada erro em Erros do sistema."
        actions={
          <Link
            to="/ze-tech-erros"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Abrir erros do sistema
          </Link>
        }
      />

      <div className="mb-5">
        <SeletorPeriodo periodo={periodo} aoMudar={setPeriodo} />
      </div>

      {carregando && !resumo ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Erros abertos"
              value={num(resumo?.erros_abertos ?? 0, 0)}
              hint={`${num(resumo?.erros_novos ?? 0, 0)} novos no período · ${num(resumo?.erros_reincidentes ?? 0, 0)} reincidentes`}
              icon={Bug}
              tone={(resumo?.erros_abertos ?? 0) > 0 ? "danger" : "success"}
            />
            <StatCard
              label="Clientes com erro"
              value={num(resumo?.clientes_com_erro ?? 0, 0)}
              hint="Com erro aparecendo no período"
              tone={(resumo?.clientes_com_erro ?? 0) > 0 ? "warning" : "default"}
            />
            <StatCard
              label="Clientes com uso"
              value={num(resumo?.clientes_ativos ?? 0, 0)}
              hint={`${num(resumo?.usuarios_ativos ?? 0, 0)} usuários ativos · ${num(resumo?.acoes ?? 0, 0)} ações`}
              icon={Users}
              tone="accent"
            />
            <StatCard
              label="Clientes sem uso"
              value={num(resumo?.clientes_sem_uso ?? 0, 0)}
              hint="Cadastrados sem nenhuma ação no período"
              icon={UserX}
              tone={(resumo?.clientes_sem_uso ?? 0) > 0 ? "warning" : "default"}
            />
          </div>

          <div className="mb-5 grid gap-3 lg:grid-cols-2">
            <div className="panel p-4">
              <h2 className="mb-3 font-display text-sm font-semibold">Uso por dia</h2>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={diasGrafico}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="rotulo" fontSize={12} />
                    <YAxis fontSize={12} allowDecimals={false} />
                    <Tooltip
                      formatter={(v: number, nome: string) => [
                        num(v, 0),
                        nome === "acoes" ? "Ações" : "Usuários ativos",
                      ]}
                    />
                    <Bar dataKey="acoes" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
                    <Bar
                      dataKey="usuarios_ativos"
                      fill="var(--color-accent)"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="panel p-4">
              <h2 className="mb-3 font-display text-sm font-semibold">Erros novos por dia</h2>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={diasGrafico}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="rotulo" fontSize={12} />
                    <YAxis fontSize={12} allowDecimals={false} />
                    <Tooltip formatter={(v: number) => [num(v, 0), "Erros novos"]} />
                    <Bar
                      dataKey="erros_novos"
                      fill="var(--color-destructive)"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <h2 className="mb-3 font-display text-base font-semibold">Uso por cliente</h2>
          {clientes.length === 0 ? (
            <EmptyState
              title="Nenhum cliente cadastrado."
              description="Cadastre os clientes no painel da EZRA para acompanhar o uso de cada um."
            />
          ) : (
            <div className="panel mb-5 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Usuários ativos</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                    <TableHead>Última atividade</TableHead>
                    <TableHead>Último login</TableHead>
                    <TableHead className="text-right">Erros</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clientes.map((c) => (
                    <TableRow key={c.tenant_id}>
                      <TableCell className="font-medium">{c.cliente}</TableCell>
                      <TableCell className="text-numeric text-right">
                        {num(c.usuarios_ativos, 0)}
                      </TableCell>
                      <TableCell className="text-numeric text-right">{num(c.acoes, 0)}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {dateTimeBR(c.ultima_atividade)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {dateTimeBR(c.ultimo_login)}
                      </TableCell>
                      <TableCell className="text-right">
                        {c.erros_abertos > 0 ? (
                          <Badge variant="destructive">
                            {num(c.erros_abertos, 0)} {c.erros_abertos === 1 ? "aberto" : "abertos"}
                          </Badge>
                        ) : c.erros_periodo > 0 ? (
                          <Badge variant="secondary">{num(c.erros_periodo, 0)} no período</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <h2 className="mb-3 font-display text-base font-semibold">
            Erros abertos que mais se repetem
          </h2>
          {topErros.length === 0 ? (
            <EmptyState
              title="Nenhum erro aberto no período."
              description="Quando um erro voltar a aparecer no período, ele aparece aqui."
            />
          ) : (
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Erro</TableHead>
                    <TableHead>Onde</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Vezes</TableHead>
                    <TableHead>Última vez</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topErros.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="max-w-md">
                        <span className="font-medium">{e.mensagem}</span>
                        <div className="mt-1">
                          <Badge variant="outline">
                            {e.origem === "servidor" ? "Servidor" : "Navegador"}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{e.rota ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{e.cliente ?? "—"}</TableCell>
                      <TableCell className="text-numeric text-right font-semibold">
                        {num(e.ocorrencias, 0)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {dateTimeBR(e.ultima_vez)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <p className="mt-4 flex items-center gap-1 text-xs text-muted-foreground">
            <Activity className="size-3" /> Uso medido pelas ações gravadas no sistema (auditoria) e
            pelo último login; erros pelo monitoramento automático do navegador e do servidor.
          </p>
        </>
      )}
    </div>
  );
}
