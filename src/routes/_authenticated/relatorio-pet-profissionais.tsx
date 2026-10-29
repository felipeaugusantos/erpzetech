import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/relatorio-pet-profissionais")({
  head: () => ({
    meta: [
      { title: "Serviços por profissional — EZRA ERP" },
      {
        name: "description",
        content:
          "Atendimentos, faturamento e comissão de cada profissional do pet shop no período.",
      },
    ],
  }),
  component: RelatorioModulo,
});

type Linha = {
  profissional_id: string;
  nome: string;
  atendimentos: number;
  servicos: number;
  faturamento: number;
  comissao_a_aprovar: number;
  comissao_aprovada: number;
  comissao_paga: number;
};

const hoje = () => new Date().toISOString().slice(0, 10);
const primeiroDoMes = () => `${hoje().slice(0, 8)}01`;

function RelatorioModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.petshop) return <ModuloBloqueado modulo="petshop" />;
  return <Relatorio />;
}

function Relatorio() {
  const { data: session } = useSessionData();
  const pode = (session?.roles ?? []).some((r) =>
    ["administrador", "gestor", "financeiro"].includes(r),
  );
  const [de, setDe] = useState(primeiroDoMes);
  const [ate, setAte] = useState(hoje);

  const { data, isLoading, error } = useQuery({
    queryKey: ["relatorio-pet-profissionais", de, ate],
    enabled: pode && !!de && !!ate && ate >= de,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pet_servicos_por_profissional", {
        p_de: de,
        p_ate: ate,
      });
      if (error) throw error;
      return (data ?? []) as unknown as Linha[];
    },
  });

  if (!pode)
    return (
      <EmptyState
        title="Sem permissão"
        description="Este relatório é de administrador, gestor e financeiro."
      />
    );

  const linhas = data ?? [];
  const tot = (k: keyof Omit<Linha, "profissional_id" | "nome">) =>
    linhas.reduce((s, l) => s + Number(l[k]), 0);

  return (
    <div>
      <PageHeader
        title="Serviços por profissional"
        description="Atendimentos já retirados e cobrados no período, com o faturamento dos serviços e a situação da comissão de cada profissional."
      />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="rp-de">De</Label>
          <Input id="rp-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="rp-ate">Até</Label>
          <Input id="rp-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>
      </div>
      {ate < de && (
        <p className="mb-3 text-sm text-destructive">A data final precisa ser depois da inicial.</p>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Atendimentos" value={String(tot("atendimentos"))} />
        <StatCard label="Faturamento dos serviços" value={brl(tot("faturamento"))} tone="accent" />
        <StatCard
          label="Comissões do período"
          value={brl(tot("comissao_a_aprovar") + tot("comissao_aprovada") + tot("comissao_paga"))}
          tone="warning"
        />
      </div>

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : error ? (
        <EmptyState title="Não foi possível carregar" description={(error as Error).message} />
      ) : linhas.length === 0 ? (
        <EmptyState title="Nenhum atendimento retirado no período" />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Profissional</TableHead>
                <TableHead className="text-right">Atendimentos</TableHead>
                <TableHead className="text-right">Serviços</TableHead>
                <TableHead className="text-right">Faturamento</TableHead>
                <TableHead className="text-right">A aprovar</TableHead>
                <TableHead className="text-right">Aprovada</TableHead>
                <TableHead className="text-right">Paga</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.profissional_id}>
                  <TableCell className="font-medium">{l.nome}</TableCell>
                  <TableCell className="text-right">{l.atendimentos}</TableCell>
                  <TableCell className="text-right">{l.servicos}</TableCell>
                  <TableCell className="text-right">{brl(Number(l.faturamento))}</TableCell>
                  <TableCell className="text-right">{brl(Number(l.comissao_a_aprovar))}</TableCell>
                  <TableCell className="text-right">{brl(Number(l.comissao_aprovada))}</TableCell>
                  <TableCell className="text-right">{brl(Number(l.comissao_paga))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total</TableCell>
                <TableCell className="text-right">{tot("atendimentos")}</TableCell>
                <TableCell className="text-right">{tot("servicos")}</TableCell>
                <TableCell className="text-right">{brl(tot("faturamento"))}</TableCell>
                <TableCell className="text-right">{brl(tot("comissao_a_aprovar"))}</TableCell>
                <TableCell className="text-right">{brl(tot("comissao_aprovada"))}</TableCell>
                <TableCell className="text-right">{brl(tot("comissao_paga"))}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </div>
  );
}
