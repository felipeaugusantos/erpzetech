import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Clock, Hourglass, PawPrint, Stethoscope } from "lucide-react";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { SeletorPeriodo } from "@/components/app/SeletorPeriodo";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { periodoDoAtalho, type Periodo } from "@/lib/periodo";
import { minutosLegiveis } from "@/lib/clinica-veterinarios";

export const Route = createFileRoute("/_authenticated/clinica-veterinarios")({
  head: () => ({
    meta: [
      { title: "Visão por veterinário — ERP Ze Tech" },
      {
        name: "description",
        content: "Atendimentos, pacientes e tempo médio de espera de cada veterinário.",
      },
      { property: "og:title", content: "Visão por veterinário — ERP Ze Tech" },
      {
        property: "og:description",
        content: "O dia a dia de cada veterinário da clínica.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VisaoModulo,
});

type Vet = {
  id: string;
  nome: string;
  crmv: string;
  crmv_uf: string;
  atendimentos: number;
  em_aberto: number;
  pacientes: number;
  duracao_media_min: number | null;
  espera_media_min: number | null;
  chamados: number;
};

function VisaoModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <VisaoVeterinarios />;
}

function VisaoVeterinarios() {
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDoAtalho("hoje"));
  const valido = /^\d{4}-\d{2}-\d{2}$/.test(periodo.de) && /^\d{4}-\d{2}-\d{2}$/.test(periodo.ate);

  const vets = useQuery({
    queryKey: ["clinica-visao-veterinarios", periodo.de, periodo.ate],
    enabled: valido,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_visao_veterinarios", {
        p_de: periodo.de,
        p_ate: periodo.ate,
      });
      if (error) throw error;
      return (data ?? []) as unknown as Vet[];
    },
  });
  const fila = useQuery({
    queryKey: ["clinica-fila-agora"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_fila_aguardando_agora");
      if (error) throw error;
      return data as unknown as { aguardando: number; espera_atual_max_min: number | null };
    },
  });

  const lista = vets.data ?? [];
  const total = lista.reduce((s, v) => s + v.atendimentos, 0);
  const pacientes = lista.reduce((s, v) => s + v.pacientes, 0);
  const chamados = lista.reduce((s, v) => s + v.chamados, 0);
  const esperaGeral = chamados
    ? Math.round(lista.reduce((s, v) => s + (v.espera_media_min ?? 0) * v.chamados, 0) / chamados)
    : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Visão por veterinário"
        description="Atendimentos, pacientes e tempo de espera de cada veterinário. Atualiza a cada minuto."
      />
      <SeletorPeriodo periodo={periodo} aoMudar={setPeriodo} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Atendimentos" value={String(total)} icon={Stethoscope} tone="accent" />
        <StatCard label="Pacientes" value={String(pacientes)} icon={PawPrint} />
        <StatCard
          label="Espera média"
          value={minutosLegiveis(esperaGeral)}
          hint="Da chegada na fila até ser chamado"
          icon={Hourglass}
        />
        <StatCard
          label="Aguardando agora"
          value={String(fila.data?.aguardando ?? 0)}
          hint={
            fila.data?.espera_atual_max_min != null
              ? `Maior espera: ${minutosLegiveis(fila.data.espera_atual_max_min)}`
              : "Fila vazia"
          }
          icon={Clock}
          tone={(fila.data?.espera_atual_max_min ?? 0) > 30 ? "warning" : "default"}
        />
      </div>

      {vets.error ? (
        <EmptyState
          title="Não foi possível abrir a visão"
          description={(vets.error as Error).message}
        />
      ) : vets.isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhum veterinário ativo"
          description="Cadastre os veterinários com CRMV em Profissionais."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {lista.map((v) => (
            <div key={v.id} className="panel p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display font-semibold">{v.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    CRMV {v.crmv}/{v.crmv_uf}
                  </p>
                </div>
                {v.em_aberto > 0 && <Badge>{v.em_aberto} em atendimento</Badge>}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Atendimentos</dt>
                  <dd className="font-display text-xl font-semibold">{v.atendimentos}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Pacientes</dt>
                  <dd className="font-display text-xl font-semibold">{v.pacientes}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Espera média</dt>
                  <dd className="font-semibold">{minutosLegiveis(v.espera_media_min)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Duração média</dt>
                  <dd className="font-semibold">{minutosLegiveis(v.duracao_media_min)}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Espera média conta só os pacientes da fila chamados pelo veterinário. Duração média conta os
        atendimentos fechados.
      </p>
    </div>
  );
}
