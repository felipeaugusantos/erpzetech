import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, FileText, Percent, Save } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl, num } from "@/lib/format";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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

export const Route = createFileRoute("/_authenticated/impostos-nota")({
  head: () => ({
    meta: [
      { title: "Impostos por nota fiscal — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Confira e ajuste as alíquotas de ICMS, substituição tributária, PIS, COFINS e ISS de cada item antes de transmitir a nota fiscal.",
      },
      { property: "og:title", content: "Impostos por nota fiscal — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Cálculo de impostos item a item da nota fiscal no ERP Ze Tech.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ImpostosNota;
});

type Item = {
  id: string;
  descricao: string | null;
  codigo: string | null;
  unidade: string | null;
  quantidade: number;
  total: number;
  cst_csosn: string | null;
  cfop: string | null;
  aliquota_icms: number;
  base_icms: number;
  valor_icms: number;
  base_icms_st: number;
  valor_icms_st: number;
  aliquota_pis: number;
  valor_pis: number;
  aliquota_cofins: number;
  valor_cofins: number;
  aliquota_iss: number;
  valor_iss: number;
};

function ImpostosNota() {
  const qc = useQueryClient();
  const [notaId, setNotaId] = useState<string>("");
  const [edicoes, setEdicoes] = useState<Record<string, string>>({});
  const [icms, setIcms] = useState("");
  const [pis, setPis] = useState("");
  const [cofins, setCofins] = useState("");
  const [iss, setIss] = useState("");
  const [todos, setTodos] = useState(false);

  const { data: config } = useQuery({
    queryKey: ["fiscal-config-impostos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fiscal_config").select("*").limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: notas, isLoading } = useQuery({
    queryKey: ["impostos-notas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nfe")
        .select(
          "id, numero, serie, situacao, ambiente, natureza_operacao, valor_produtos, valor_total, valor_icms, valor_icms_st, valor_pis, valor_cofins, valor_iss, base_icms, impostos_calculados_em, created_at, clientes(nome), depositos(nome)",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!notaId && (notas ?? []).length) setNotaId(notas![0]!.id);
  }, [notas, notaId]);

  const nota = useMemo(
    () => (notas ?? []).find((n: any) => n.id === notaId) ?? null,
    [notas, notaId],
  );
  const editavel = nota ? ["rascunho", "pronta"].includes(String(nota.situacao)) : false;

  const { data: itens } = useQuery({
    queryKey: ["impostos-itens", notaId],
    enabled: !!notaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nfe_itens")
        .select(
          "id, descricao, codigo, unidade, quantidade, total, cst_csosn, cfop, aliquota_icms, base_icms, valor_icms, base_icms_st, valor_icms_st, aliquota_pis, valor_pis, aliquota_cofins, valor_cofins, aliquota_iss, valor_iss",
        )
        .eq("nfe_id", notaId)
        .order("descricao");
      if (error) throw error;
      return (data ?? []) as Item[];
    },
  });

  useEffect(() => {
    setEdicoes({});
  }, [notaId]);

  const calcular = useMutation({
    mutationFn: async () => {
      if (!notaId) throw new Error("Escolha uma nota fiscal");
      const dec = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")) || 0);

      // Primeiro grava as alíquotas digitadas item a item.
      for (const [id, valor] of Object.entries(edicoes)) {
        const { error } = await supabase
          .from("nfe_itens")
          .update({ aliquota_icms: Number(valor.replace(",", ".")) || 0 })
          .eq("id", id);
        if (error) throw error;
      }

      const { data, error } = await supabase.rpc("nfe_calcular_impostos", {
        p_nfe_id: notaId,
        p_aliquota_icms: dec(icms),
        p_aliquota_pis: dec(pis),
        p_aliquota_cofins: dec(cofins),
        p_aliquota_iss: dec(iss),
        p_reducao_base: null,
        p_aplicar_icms_em_todos: todos,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: () => {
      toast.success("Impostos calculados", {
        description: "A nota passa a sair com esses valores.",
      });
      setEdicoes({});
      qc.invalidateQueries({ queryKey: ["impostos-itens", notaId] });
      qc.invalidateQueries({ queryKey: ["impostos-notas"] });
      qc.invalidateQueries({ queryKey: ["nfe-lista"] });
    },
    onError: (e: Error) => toast.error("Não foi possível calcular", { description: e.message }),
  });

  const totalImpostos =
    num(nota?.valor_icms) +
    num(nota?.valor_icms_st) +
    num(nota?.valor_pis) +
    num(nota?.valor_cofins) +
    num(nota?.valor_iss);

  return (
    <>
      <PageHeader
        title="Impostos por nota fiscal"
        description="Confira e ajuste as alíquotas de cada item, calcule os impostos e deixe a nota pronta para sair com os valores certos."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/impostos">
                <Percent className="size-4" /> Alíquotas da empresa
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/nfe">
                <FileText className="size-4" /> Notas fiscais
              </Link>
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (notas ?? []).length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Nenhuma nota fiscal gerada."
          description="Gere a nota de um pedido para calcular os impostos."
          action={
            <Button asChild>
              <Link to="/nfe">Ir para notas fiscais</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="nota">Nota fiscal</Label>
                <Select value={notaId} onValueChange={setNotaId}>
                  <SelectTrigger id="nota">
                    <SelectValue placeholder="Escolha a nota" />
                  </SelectTrigger>
                  <SelectContent>
                    {(notas ?? []).map((n: any) => (
                      <SelectItem key={n.id} value={n.id}>
                        {`${n.numero ? `nº ${n.numero}` : "sem número"} · ${
                          n.clientes?.nome ?? "Consumidor final"
                        } · ${brl(num(n.valor_total))}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-end gap-3 text-sm">
                {nota && (
                  <>
                    <Badge variant={editavel ? "secondary" : "outline"}>{nota.situacao}</Badge>
                    <span className="text-muted-foreground">
                      {nota.depositos?.nome ? `Depósito ${nota.depositos.nome}` : "Sem depósito"} ·{" "}
                      {nota.ambiente === "producao" ? "produção" : "homologação"}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="ICMS" value={brl(num(nota?.valor_icms))} icon={Percent} />
            <StatCard label="ICMS substituição" value={brl(num(nota?.valor_icms_st))} icon={Percent} />
            <StatCard label="PIS" value={brl(num(nota?.valor_pis))} icon={Percent} />
            <StatCard label="COFINS" value={brl(num(nota?.valor_cofins))} icon={Percent} />
            <StatCard label="ISS" value={brl(num(nota?.valor_iss))} icon={Percent} />
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <p className="font-display text-sm font-semibold">Alíquotas deste cálculo</p>
            <p className="mb-4 text-xs text-muted-foreground">
              Deixe em branco para usar as alíquotas da empresa (ICMS{" "}
              {num(config?.aliquota_icms_interna)}% · PIS {num(config?.aliquota_pis)}% · COFINS{" "}
              {num(config?.aliquota_cofins)}% · ISS {num(config?.aliquota_iss)}%).
            </p>
            <div className="grid gap-4 sm:grid-cols-4">
              <div>
                <Label htmlFor="ali-icms">ICMS %</Label>
                <Input
                  id="ali-icms"
                  inputMode="decimal"
                  value={icms}
                  disabled={!editavel}
                  onChange={(e) => setIcms(e.target.value)}
                  placeholder={String(num(config?.aliquota_icms_interna))}
                />
              </div>
              <div>
                <Label htmlFor="ali-pis">PIS %</Label>
                <Input
                  id="ali-pis"
                  inputMode="decimal"
                  value={pis}
                  disabled={!editavel}
                  onChange={(e) => setPis(e.target.value)}
                  placeholder={String(num(config?.aliquota_pis))}
                />
              </div>
              <div>
                <Label htmlFor="ali-cofins">COFINS %</Label>
                <Input
                  id="ali-cofins"
                  inputMode="decimal"
                  value={cofins}
                  disabled={!editavel}
                  onChange={(e) => setCofins(e.target.value)}
                  placeholder={String(num(config?.aliquota_cofins))}
                />
              </div>
              <div>
                <Label htmlFor="ali-iss">ISS %</Label>
                <Input
                  id="ali-iss"
                  inputMode="decimal"
                  value={iss}
                  disabled={!editavel}
                  onChange={(e) => setIss(e.target.value)}
                  placeholder={String(num(config?.aliquota_iss))}
                />
              </div>
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm">
              <Checkbox
                checked={todos}
                disabled={!editavel}
                onCheckedChange={(v) => setTodos(v === true)}
              />
              Aplicar o ICMS informado em todos os itens, inclusive nos que já têm alíquota própria
            </label>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={() => calcular.mutate()} disabled={!editavel || calcular.isPending}>
                <Calculator className="size-4" /> Calcular impostos da nota
              </Button>
              <span className="text-sm text-muted-foreground">
                Total de impostos: <strong className="text-foreground">{brl(totalImpostos)}</strong>
                {nota?.impostos_calculados_em ? " · já calculada" : " · ainda não calculada"}
              </span>
            </div>
            {!editavel && nota && (
              <p className="mt-3 text-xs text-muted-foreground">
                Nota {nota.situacao}: os impostos não podem mais ser alterados.
              </p>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>CST/CSOSN</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="w-24 text-right">ICMS %</TableHead>
                  <TableHead className="text-right">Base ICMS</TableHead>
                  <TableHead className="text-right">ICMS</TableHead>
                  <TableHead className="text-right">ICMS ST</TableHead>
                  <TableHead className="text-right">PIS</TableHead>
                  <TableHead className="text-right">COFINS</TableHead>
                  <TableHead className="text-right">ISS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(itens ?? []).map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <p className="font-medium">{i.descricao}</p>
                      <p className="text-xs text-muted-foreground">
                        {i.codigo} · {num(i.quantidade, 3)} {i.unidade} · CFOP {i.cfop ?? "—"}
                      </p>
                    </TableCell>
                    <TableCell>{i.cst_csosn ?? "—"}</TableCell>
                    <TableCell className="text-right">{brl(num(i.total))}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        inputMode="decimal"
                        className="h-8 w-20 text-right"
                        disabled={!editavel}
                        value={edicoes[i.id] ?? String(num(i.aliquota_icms))}
                        onChange={(e) =>
                          setEdicoes((m) => ({ ...m, [i.id]: e.target.value }))
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right">{brl(num(i.base_icms))}</TableCell>
                    <TableCell className="text-right">{brl(num(i.valor_icms))}</TableCell>
                    <TableCell className="text-right">{brl(num(i.valor_icms_st))}</TableCell>
                    <TableCell className="text-right">{brl(num(i.valor_pis))}</TableCell>
                    <TableCell className="text-right">{brl(num(i.valor_cofins))}</TableCell>
                    <TableCell className="text-right">{brl(num(i.valor_iss))}</TableCell>
                  </TableRow>
                ))}
                {(itens ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-sm text-muted-foreground">
                      Esta nota não tem itens.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {Object.keys(edicoes).length > 0 && editavel && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Save className="size-4" /> Há alíquotas alteradas: clique em "Calcular impostos da
              nota" para gravar.
            </p>
          )}
        </div>
      )}
    </>
  );
}
