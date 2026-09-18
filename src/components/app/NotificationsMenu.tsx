import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bell, PackageX, TrendingDown } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { brl, num } from "@/lib/format";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

type Alerta = { id: string; titulo: string; detalhe: string; tipo: "baixo" | "zerado" | "credito" };

export function NotificationsMenu() {
  const { data } = useQuery({
    queryKey: ["alertas"],
    queryFn: async (): Promise<Alerta[]> => {
      const [{ data: estoques }, { data: clientes }] = await Promise.all([
        supabase
          .from("estoques")
          .select("id, quantidade, reservado, produtos(descricao, estoque_minimo, unidade)")
          .limit(500),
        supabase.from("clientes").select("id, nome, limite_credito, saldo_utilizado").limit(200),
      ]);

      const alertas: Alerta[] = [];
      for (const e of estoques ?? []) {
        const p = e.produtos as { descricao: string; estoque_minimo: number; unidade: string } | null;
        if (!p) continue;
        const disponivel = Number(e.quantidade) - Number(e.reservado);
        if (disponivel <= 0) {
          alertas.push({
            id: `z-${e.id}`,
            titulo: p.descricao,
            detalhe: "Sem estoque disponível",
            tipo: "zerado",
          });
        } else if (disponivel < Number(p.estoque_minimo)) {
          alertas.push({
            id: `b-${e.id}`,
            titulo: p.descricao,
            detalhe: `Disponível ${num(disponivel)} ${p.unidade} • mínimo ${num(p.estoque_minimo)}`,
            tipo: "baixo",
          });
        }
      }
      for (const c of clientes ?? []) {
        if (Number(c.limite_credito) > 0 && Number(c.saldo_utilizado) >= Number(c.limite_credito) * 0.9) {
          alertas.push({
            id: `c-${c.id}`,
            titulo: c.nome,
            detalhe: `Crédito usado ${brl(c.saldo_utilizado)} de ${brl(c.limite_credito)}`,
            tipo: "credito",
          });
        }
      }
      return alertas.slice(0, 30);
    },
  });

  const count = data?.length ?? 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notificações">
          <Bell className="size-5" />
          {count > 0 && (
            <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-accent text-[9px] font-bold text-accent-foreground">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Central de notificações</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-80 overflow-y-auto">
          {count === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              Nenhum alerta no momento.
            </p>
          )}
          {(data ?? []).map((a) => (
            <div key={a.id} className="flex gap-2 px-2 py-2 text-sm">
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
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
