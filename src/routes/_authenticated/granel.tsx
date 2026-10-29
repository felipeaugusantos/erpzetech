import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageOpen } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { brl, dateTimeBR, num } from "@/lib/format";
import { custoDoKg, kgDosSacos, margemDoKg } from "@/lib/granel";

export const Route = createFileRoute("/_authenticated/granel")({
  head: () => ({
    meta: [
      { title: "Venda a granel — EZRA ERP" },
      {
        name: "description",
        content:
          "Abra o saco e passe os kg para o produto vendido a granel, com o custo proporcional.",
      },
    ],
  }),
  component: Granel,
});

function Granel() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const roles = session?.roles ?? [];
  const pode = roles.some((r) => ["administrador", "gestor", "estoquista"].includes(r));
  const [depositoSel, setDepositoSel] = useState("");
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [sacos, setSacos] = useState("1");

  const { data: depositos } = useQuery({
    queryKey: ["depositos-granel"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("depositos")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });
  const depositoId = depositoSel || depositos?.[0]?.id || "";

  const { data, isLoading } = useQuery({
    queryKey: ["granel", depositoId],
    enabled: Boolean(depositoId),
    queryFn: async () => {
      const { data: sacosProd, error } = await supabase
        .from("produtos")
        .select("id, descricao, custo, granel_produto_id, granel_fator")
        .not("granel_produto_id", "is", null)
        .eq("ativo", true)
        .order("descricao");
      if (error) throw error;
      const ids = [
        ...new Set([
          ...(sacosProd ?? []).map((s) => s.id),
          ...(sacosProd ?? []).map((s) => s.granel_produto_id as string),
        ]),
      ];
      const [granelProd, saldos, aberturas] = await Promise.all([
        ids.length
          ? supabase.from("produtos").select("id, descricao, unidade, preco_venda").in("id", ids)
          : Promise.resolve({ data: [], error: null }),
        ids.length
          ? supabase
              .from("estoques")
              .select("produto_id, quantidade, custo_medio")
              .eq("deposito_id", depositoId)
              .in("produto_id", ids)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from("granel_aberturas")
          .select("id, saco_produto_id, granel_produto_id, sacos, kg, custo_kg, created_at")
          .eq("deposito_id", depositoId)
          .order("created_at", { ascending: false })
          .limit(30),
      ]);
      for (const r of [granelProd, saldos, aberturas]) if (r.error) throw r.error;
      return {
        sacos: sacosProd ?? [],
        produtos: new Map((granelProd.data ?? []).map((p) => [p.id, p])),
        saldos: new Map((saldos.data ?? []).map((s) => [s.produto_id, s])),
        aberturas: aberturas.data ?? [],
      };
    },
  });

  const nome = (id: string) => data?.produtos.get(id)?.descricao ?? "—";
  const aberto = data?.sacos.find((s) => s.id === abrindo);
  const qtd = Math.trunc(Number(sacos.replace(",", ".")));
  const fator = Number(aberto?.granel_fator ?? 0);
  const saldoSaco = aberto ? Number(data?.saldos.get(aberto.id)?.quantidade ?? 0) : 0;
  const custoSaco = aberto
    ? Number(data?.saldos.get(aberto.id)?.custo_medio) > 0
      ? Number(data?.saldos.get(aberto.id)?.custo_medio)
      : Number(aberto.custo)
    : 0;
  const custoKg = custoDoKg(custoSaco, fator);
  const precoKg = aberto
    ? Number(data?.produtos.get(aberto.granel_produto_id as string)?.preco_venda ?? 0)
    : 0;
  const margem = margemDoKg(precoKg, custoKg);

  const abrir = useMutation({
    mutationFn: async () => {
      if (!aberto) return;
      const { error } = await supabase.rpc("granel_abrir_saco", {
        p_saco_produto_id: aberto.id,
        p_deposito_id: depositoId,
        p_sacos: qtd,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Saco aberto", {
        description: `${num(kgDosSacos(qtd, fator), 3)} kg foram para ${nome(aberto?.granel_produto_id as string)}.`,
      });
      setAbrindo(null);
      setSacos("1");
      for (const k of ["granel", "estoque-movimentos", "produtos", "estoque"])
        qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e: Error) => toast.error("Não foi possível abrir o saco", { description: e.message }),
  });

  return (
    <div>
      <PageHeader
        title="Venda a granel"
        description="Abrir o saco baixa o saco inteiro e dá entrada dos kg no produto vendido a granel, pelo custo proporcional. A venda por kg segue normal no caixa."
      />

      <div className="mb-4 w-64">
        <Select value={depositoId} onValueChange={setDepositoSel}>
          <SelectTrigger aria-label="Depósito">
            <SelectValue placeholder="Depósito" />
          </SelectTrigger>
          <SelectContent>
            {(depositos ?? []).map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : (data?.sacos ?? []).length === 0 ? (
        <EmptyState
          title="Nenhum produto com granel cadastrado"
          description="No cadastro do saco, informe o produto vendido por kg e quantos kg tem o saco."
          action={
            <Button asChild variant="outline">
              <Link to="/produtos">Ir para Produtos</Link>
            </Button>
          }
        />
      ) : (
        <div className="panel mb-6 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Saco</TableHead>
                <TableHead className="text-right">Sacos em estoque</TableHead>
                <TableHead>Vendido a granel como</TableHead>
                <TableHead className="text-right">Granel em estoque</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.sacos.map((s) => {
                const gran = data.produtos.get(s.granel_produto_id as string);
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      {s.descricao}
                      <span className="block text-xs text-muted-foreground">
                        {num(Number(s.granel_fator), 3)} kg por saco
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {num(Number(data.saldos.get(s.id)?.quantidade ?? 0), 0)}
                    </TableCell>
                    <TableCell>{gran?.descricao ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {num(
                        Number(data.saldos.get(s.granel_produto_id as string)?.quantidade ?? 0),
                        3,
                      )}{" "}
                      {gran?.unidade}
                    </TableCell>
                    <TableCell className="text-right">
                      {pode && (
                        <Button size="sm" onClick={() => setAbrindo(s.id)}>
                          <PackageOpen className="size-4" /> Abrir saco
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

      {(data?.aberturas ?? []).length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold">Últimas aberturas</h2>
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Saco</TableHead>
                  <TableHead className="text-right">Sacos</TableHead>
                  <TableHead className="text-right">Kg</TableHead>
                  <TableHead className="text-right">Custo do kg</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.aberturas.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{dateTimeBR(a.created_at)}</TableCell>
                    <TableCell>{nome(a.saco_produto_id)}</TableCell>
                    <TableCell className="text-right">{a.sacos}</TableCell>
                    <TableCell className="text-right">{num(Number(a.kg), 3)}</TableCell>
                    <TableCell className="text-right">{brl(Number(a.custo_kg))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <Dialog open={Boolean(aberto)} onOpenChange={(o) => !o && setAbrindo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abrir saco</DialogTitle>
            <DialogDescription>{aberto?.descricao}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="g-sacos">Quantos sacos abrir</Label>
              <Input
                id="g-sacos"
                inputMode="numeric"
                value={sacos}
                onChange={(e) => setSacos(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Em estoque: {num(saldoSaco, 0)} saco(s).
              </p>
            </div>
            {qtd >= 1 && (
              <div className="rounded-md border p-3 text-sm">
                Entram <strong>{num(kgDosSacos(qtd, fator), 3)} kg</strong> em{" "}
                {nome(aberto?.granel_produto_id as string)}, a <strong>{brl(custoKg)}</strong> o kg
                {margem !== null && (
                  <>
                    {" "}
                    (vendido a {brl(precoKg)}: margem de {num(margem, 1)}%)
                  </>
                )}
                .
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbrindo(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => abrir.mutate()}
              disabled={abrir.isPending || !(qtd >= 1) || qtd > 1000}
            >
              Abrir {qtd >= 1 ? qtd : ""} saco(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
