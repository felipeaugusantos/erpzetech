import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { dateBR } from "@/lib/format";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/pet-comissoes")({
  head: () => ({
    meta: [
      { title: "Comissões do pet shop — EZRA ERP" },
      {
        name: "description",
        content: "Comissões dos profissionais do pet shop: aprovar e registrar o pagamento.",
      },
    ],
  }),
  component: ComissoesModulo,
});

const ROTULO: Record<string, string> = {
  a_aprovar: "A aprovar",
  aprovada: "Aprovada",
  paga: "Paga",
  cancelada: "Cancelada",
};
const FILTROS = [
  { value: "abertas", label: "A aprovar e aprovadas" },
  { value: "a_aprovar", label: "A aprovar" },
  { value: "aprovada", label: "Aprovadas (a pagar)" },
  { value: "paga", label: "Pagas" },
  { value: "cancelada", label: "Canceladas" },
  { value: "todas", label: "Todas" },
] as const;

function ComissoesModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.petshop) return <ModuloBloqueado modulo="petshop" />;
  return <Comissoes />;
}

function Comissoes() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const pode = (session?.roles ?? []).some((r) =>
    ["administrador", "gestor", "financeiro"].includes(r),
  );
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]["value"]>("abertas");

  const { data, isLoading } = useQuery({
    queryKey: ["pet-comissoes"],
    enabled: pode,
    queryFn: async () => {
      const { data: com, error } = await supabase
        .from("pet_comissoes")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const comissoes = com ?? [];
      const ags = comissoes.length
        ? await supabase
            .from("pet_agendamentos")
            .select("id, inicio, pet_id")
            .in(
              "id",
              comissoes.map((c) => c.agendamento_id),
            )
        : { data: [], error: null };
      if (ags.error) throw ags.error;
      const [profs, pets] = await Promise.all([
        supabase.from("pet_profissionais").select("id, nome"),
        supabase
          .from("pets")
          .select("id, nome")
          .in("id", [...new Set((ags.data ?? []).map((a) => a.pet_id))]),
      ]);
      if (profs.error) throw profs.error;
      if (pets.error) throw pets.error;
      return { comissoes, ags: ags.data ?? [], profs: profs.data ?? [], pets: pets.data ?? [] };
    },
  });

  const lista = (data?.comissoes ?? []).filter((c) =>
    filtro === "todas"
      ? true
      : filtro === "abertas"
        ? c.situacao === "a_aprovar" || c.situacao === "aprovada"
        : c.situacao === filtro,
  );
  const soma = (sit: string) =>
    (data?.comissoes ?? [])
      .filter((c) => c.situacao === sit)
      .reduce((s, c) => s + Number(c.valor), 0);

  const agir = useMutation({
    mutationFn: async (p: { id: string; acao: "aprovar" | "pagar" }) => {
      const { error } =
        p.acao === "aprovar"
          ? await supabase.rpc("pet_comissao_aprovar", { p_id: p.id })
          : await supabase.rpc("pet_comissao_pagar", { p_id: p.id });
      if (error) throw error;
    },
    onSuccess: (_, p) => {
      toast.success(p.acao === "aprovar" ? "Comissão aprovada." : "Pagamento registrado.");
      void qc.invalidateQueries({ queryKey: ["pet-comissoes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!pode)
    return (
      <EmptyState
        title="Sem permissão"
        description="As comissões do pet shop são vistas por administrador, gestor e financeiro."
      />
    );

  return (
    <div>
      <PageHeader
        title="Comissões do pet shop"
        description="Nascem quando o atendimento é retirado e cobrado: percentual do profissional sobre o valor dos serviços (sem os produtos vendidos junto). Venda cancelada cancela a comissão que ainda não foi paga."
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="A aprovar" value={brl(soma("a_aprovar"))} tone="warning" />
        <StatCard label="Aprovadas (a pagar)" value={brl(soma("aprovada"))} tone="accent" />
        <StatCard label="Pagas" value={brl(soma("paga"))} tone="success" />
      </div>

      <div className="mb-4 w-64">
        <Select value={filtro} onValueChange={(v) => setFiltro(v as typeof filtro)}>
          <SelectTrigger aria-label="Filtrar comissões">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTROS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : lista.length === 0 ? (
        <EmptyState title="Nenhuma comissão neste filtro" />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Atendimento</TableHead>
                <TableHead>Profissional</TableHead>
                <TableHead className="text-right">Base</TableHead>
                <TableHead className="text-right">%</TableHead>
                <TableHead className="text-right">Comissão</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((c) => {
                const ag = data?.ags.find((a) => a.id === c.agendamento_id);
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      {ag ? dateBR(ag.inicio.slice(0, 10)) : "—"}{" "}
                      {data?.pets.find((p) => p.id === ag?.pet_id)?.nome ?? ""}
                    </TableCell>
                    <TableCell>
                      {data?.profs.find((p) => p.id === c.profissional_id)?.nome ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">{brl(Number(c.base))}</TableCell>
                    <TableCell className="text-right">{Number(c.percentual)}%</TableCell>
                    <TableCell className="text-right font-medium">{brl(Number(c.valor))}</TableCell>
                    <TableCell>
                      <Badge variant={c.situacao === "cancelada" ? "outline" : "secondary"}>
                        {ROTULO[c.situacao] ?? c.situacao}
                      </Badge>
                      {c.pago_em && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {dateBR(c.pago_em.slice(0, 10))}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {c.situacao === "a_aprovar" && (
                        <Button
                          size="sm"
                          disabled={agir.isPending}
                          onClick={() => agir.mutate({ id: c.id, acao: "aprovar" })}
                        >
                          Aprovar
                        </Button>
                      )}
                      {c.situacao === "aprovada" && (
                        <Button
                          size="sm"
                          disabled={agir.isPending}
                          onClick={() => agir.mutate({ id: c.id, acao: "pagar" })}
                        >
                          Registrar pagamento
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
    </div>
  );
}
