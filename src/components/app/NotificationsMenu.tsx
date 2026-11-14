import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Bell,
  ChevronRight,
  ClipboardList,
  FlaskConical,
  PackageX,
  TrendingDown,
  Truck,
  Wallet,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { hojeISO } from "@/lib/financeiro";
import { brl, num } from "@/lib/format";
import {
  limiteOrcamentoParado,
  pendenciasVisiveis,
  type ContagemPendencia,
} from "@/lib/pendencias";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

type Alerta = { id: string; titulo: string; detalhe: string; tipo: "baixo" | "zerado" | "credito" };

const ICONES: Record<string, typeof Wallet> = {
  pagar: Wallet,
  receber: Wallet,
  orcamentos: ClipboardList,
  entregas: Truck,
  exames: FlaskConical,
};

/** Conta só (sem trazer linhas); erro de permissão vira zero e a pendência some. */
async function contar(q: PromiseLike<{ count: number | null; error: unknown }>) {
  const { count, error } = await q;
  return error ? 0 : (count ?? 0);
}

export function NotificationsMenu({ telas = [] }: { telas?: string[] }) {
  const ve = (to: string) => telas.includes(to);

  const { data: pendencias = [] } = useQuery({
    queryKey: ["pendencias-do-dia", telas.join("|")],
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<ContagemPendencia[]> => {
      const hoje = hojeISO();
      const zero = Promise.resolve(0);
      const [pagar, receber, orcamentos, entregas, exames] = await Promise.all([
        ve("/contas-pagar")
          ? contar(
              supabase
                .from("contas_pagar")
                .select("id", { count: "exact", head: true })
                .in("situacao", ["aberto", "parcial"])
                .lte("vencimento", hoje),
            )
          : zero,
        ve("/contas-receber")
          ? contar(
              supabase
                .from("contas_receber")
                .select("id", { count: "exact", head: true })
                .in("situacao", ["aberto", "parcial"])
                .lt("vencimento", hoje),
            )
          : zero,
        ve("/orcamentos")
          ? contar(
              supabase
                .from("orcamentos")
                .select("id", { count: "exact", head: true })
                .in("situacao", ["enviado", "em_negociacao"])
                .lt("created_at", limiteOrcamentoParado()),
            )
          : zero,
        ve("/entregas")
          ? contar(
              supabase
                .from("entregas")
                .select("id", { count: "exact", head: true })
                .not("situacao", "in", "(entregue,cancelada,cancelado)")
                .lte("data_entrega", hoje),
            )
          : zero,
        ve("/clinica-exames")
          ? contar(
              supabase
                .from("pet_exames")
                .select("id", { count: "exact", head: true })
                .eq("situacao", "aberto"),
            )
          : zero,
      ]);
      return [
        { chave: "pagar", to: "/contas-pagar", titulo: "Contas a pagar vencendo até hoje", total: pagar },
        { chave: "receber", to: "/contas-receber", titulo: "Contas a receber em atraso", total: receber },
        { chave: "orcamentos", to: "/orcamentos", titulo: "Orçamentos sem resposta há mais de 48 h", total: orcamentos },
        { chave: "entregas", to: "/entregas", titulo: "Entregas do dia ou atrasadas", total: entregas },
        { chave: "exames", to: "/clinica-exames", titulo: "Exames sem laudo fechado", total: exames },
      ];
    },
  });

  const { data: alertas = [] } = useQuery({
    queryKey: ["alertas"],
    staleTime: 60_000,
    queryFn: async (): Promise<Alerta[]> => {
      const [{ data: estoques }, { data: clientes }] = await Promise.all([
        supabase
          .from("estoques")
          .select("id, quantidade, reservado, produtos(descricao, estoque_minimo, unidade)")
          .limit(500),
        supabase.from("clientes").select("id, nome, limite_credito, saldo_utilizado").limit(200),
      ]);

      const lista: Alerta[] = [];
      for (const e of estoques ?? []) {
        const p = e.produtos as { descricao: string; estoque_minimo: number; unidade: string } | null;
        if (!p) continue;
        const disponivel = Number(e.quantidade) - Number(e.reservado);
        if (disponivel <= 0) {
          lista.push({ id: `z-${e.id}`, titulo: p.descricao, detalhe: "Sem estoque disponível", tipo: "zerado" });
        } else if (disponivel < Number(p.estoque_minimo)) {
          lista.push({
            id: `b-${e.id}`,
            titulo: p.descricao,
            detalhe: `Disponível ${num(disponivel)} ${p.unidade} • mínimo ${num(p.estoque_minimo)}`,
            tipo: "baixo",
          });
        }
      }
      for (const c of clientes ?? []) {
        if (Number(c.limite_credito) > 0 && Number(c.saldo_utilizado) >= Number(c.limite_credito) * 0.9) {
          lista.push({
            id: `c-${c.id}`,
            titulo: c.nome,
            detalhe: `Crédito usado ${brl(c.saldo_utilizado)} de ${brl(c.limite_credito)}`,
            tipo: "credito",
          });
        }
      }
      return lista.slice(0, 30);
    },
  });

  const visiveis = pendenciasVisiveis(pendencias, telas);
  const count = visiveis.reduce((s, p) => s + p.total, 0) + alertas.length;
  const linkAlerta = (t: Alerta["tipo"]) =>
    t === "credito" ? (ve("/credito") ? "/credito" : null) : ve("/estoque") ? "/estoque" : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Pendências do dia">
          <Bell className="size-5" />
          {count > 0 && (
            <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-mint text-[9px] font-bold text-mint-foreground">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[22rem] max-w-[calc(100vw-1rem)]">
        <DropdownMenuLabel>Pendências do dia</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-[70vh] overflow-y-auto">
          {count === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              Tudo em dia por aqui.
            </p>
          )}
          {visiveis.map((p) => {
            const Icone = ICONES[p.chave] ?? AlertTriangle;
            return (
              <Link
                key={p.chave}
                to={p.to}
                className="flex items-center gap-3 rounded-md px-2 py-2.5 text-sm hover:bg-secondary"
              >
                <Icone className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">{p.titulo}</span>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-numeric">
                  {p.total}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            );
          })}
          {alertas.length > 0 && (
            <>
              {visiveis.length > 0 && <DropdownMenuSeparator />}
              <p className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                Estoque e crédito
              </p>
            </>
          )}
          {alertas.map((a) => {
            const to = linkAlerta(a.tipo);
            const corpo = (
              <>
                {a.tipo === "zerado" ? (
                  <PackageX className="mt-0.5 size-4 shrink-0 text-destructive" />
                ) : a.tipo === "baixo" ? (
                  <TrendingDown className="mt-0.5 size-4 shrink-0 text-warning" />
                ) : (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-info" />
                )}
                <div className="min-w-0">
                  <p className="truncate font-medium">{a.titulo}</p>
                  <p className="text-xs text-muted-foreground">{a.detalhe}</p>
                </div>
              </>
            );
            return to ? (
              <Link key={a.id} to={to} className="flex gap-2 rounded-md px-2 py-2 text-sm hover:bg-secondary">
                {corpo}
              </Link>
            ) : (
              <div key={a.id} className="flex gap-2 px-2 py-2 text-sm">
                {corpo}
              </div>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
