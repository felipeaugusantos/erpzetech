import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { Switch } from "@/components/ui/switch";
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
import { PERFIS_FAIXA, rotuloAlvo, rotuloPerfil } from "@/lib/faixas-desconto";
import { num } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/faixas-desconto")({
  head: () => ({
    meta: [
      { title: "Faixas de desconto — ERP Ze Tech" },
      {
        name: "description",
        content: "Desconto máximo por grupo, marca e perfil, sem senha do gestor.",
      },
      { property: "og:title", content: "Faixas de desconto — ERP Ze Tech" },
      { property: "og:description", content: "Desconto máximo por grupo, marca e perfil." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FaixasDesconto,
});

const TODOS = "todos";

type Form = {
  id: string | null;
  perfil: string;
  categoria: string;
  marca: string;
  percentual: string;
  ativa: boolean;
};
const FORM_VAZIO: Form = {
  id: null,
  perfil: TODOS,
  categoria: TODOS,
  marca: "",
  percentual: "5",
  ativa: true,
};

function FaixasDesconto() {
  const qc = useQueryClient();
  const { data: sessao } = useSessionData();
  const gestao = (sessao?.roles ?? []).some((r) => r === "administrador" || r === "gestor");
  const [form, setForm] = useState<Form | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["faixas-desconto"],
    queryFn: async () => {
      const [faixas, categorias, produtos, empresa] = await Promise.all([
        supabase.from("faixas_desconto").select("*"),
        supabase.from("categorias").select("id, nome").eq("ativo", true).order("nome"),
        supabase.from("produtos").select("marca").not("marca", "is", null),
        supabase.from("empresas").select("pdv_desconto_limite").limit(1).maybeSingle(),
      ]);
      if (faixas.error) throw faixas.error;
      const marcas = [
        ...new Set((produtos.data ?? []).map((p) => (p.marca ?? "").trim()).filter(Boolean)),
      ].sort((a, b) => a.localeCompare(b, "pt-BR"));
      return {
        faixas: faixas.data,
        categorias: categorias.data ?? [],
        marcas,
        padrao: Number(empresa.data?.pdv_desconto_limite ?? 5),
      };
    },
  });

  const nomeGrupo = useMemo(
    () => new Map((data?.categorias ?? []).map((c) => [c.id, c.nome])),
    [data],
  );

  const lista = useMemo(
    () =>
      [...(data?.faixas ?? [])].sort(
        (a, b) =>
          rotuloAlvo(nomeGrupo.get(a.categoria_id ?? ""), a.marca).localeCompare(
            rotuloAlvo(nomeGrupo.get(b.categoria_id ?? ""), b.marca),
            "pt-BR",
          ) || rotuloPerfil(a.perfil).localeCompare(rotuloPerfil(b.perfil), "pt-BR"),
      ),
    [data, nomeGrupo],
  );

  const salvar = useMutation({
    mutationFn: async (f: Form) => {
      const percentual = Number(f.percentual.replace(",", "."));
      if (!Number.isFinite(percentual) || percentual < 0 || percentual > 100)
        throw new Error("O desconto máximo fica entre 0% e 100%");
      const dados = {
        perfil: f.perfil === TODOS ? null : (f.perfil as (typeof PERFIS_FAIXA)[number]["valor"]),
        categoria_id: f.categoria === TODOS ? null : f.categoria,
        marca: f.marca.trim() || null,
        percentual,
        ativa: f.ativa,
      };
      const { error } = f.id
        ? await supabase.from("faixas_desconto").update(dados).eq("id", f.id)
        : await supabase.from("faixas_desconto").insert(dados);
      if (error)
        throw new Error(
          error.code === "23505"
            ? "Já existe uma faixa para esta combinação de perfil, grupo e marca"
            : error.message,
        );
    },
    onSuccess: () => {
      toast.success("Faixa salva");
      setForm(null);
      void qc.invalidateQueries({ queryKey: ["faixas-desconto"] });
      void qc.invalidateQueries({ queryKey: ["desconto-limite"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("faixas_desconto").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Faixa excluída");
      void qc.invalidateQueries({ queryKey: ["faixas-desconto"] });
      void qc.invalidateQueries({ queryKey: ["desconto-limite"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="Faixas de desconto"
        description={`Desconto máximo que o operador dá na frente de caixa sem a senha do gestor. Sem faixa para o produto vale o limite da empresa (${num(data?.padrao ?? 5)}%).`}
        actions={
          gestao ? (
            <Button onClick={() => setForm(FORM_VAZIO)}>
              <Plus className="mr-1 h-4 w-4" /> Nova faixa
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 rounded border p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Qual faixa vale para cada produto</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5">
          <li>
            Valem só as faixas ativas que combinam com o produto e com o perfil de quem vende.
          </li>
          <li>Vence a mais específica no produto: grupo + marca, depois grupo, depois marca.</li>
          <li>No mesmo nível, a faixa de um perfil vence a de "todos os perfis".</li>
          <li>Se a pessoa tem mais de um perfil com faixa no mesmo nível, vale a maior.</li>
          <li>
            O desconto da venda é a soma do limite de cada item. Acima disso, pede a senha do
            gestor.
          </li>
        </ol>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhuma faixa cadastrada"
          description="Todos os produtos usam o limite único da empresa."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produtos</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead className="text-right">Desconto máximo</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((f) => (
                <TableRow key={f.id}>
                  <TableCell>
                    {rotuloAlvo(
                      f.categoria_id ? (nomeGrupo.get(f.categoria_id) ?? "Grupo removido") : null,
                      f.marca,
                    )}
                  </TableCell>
                  <TableCell>{rotuloPerfil(f.perfil)}</TableCell>
                  <TableCell className="text-right font-medium">
                    {num(Number(f.percentual))}%
                  </TableCell>
                  <TableCell>
                    <Badge variant={f.ativa ? "secondary" : "outline"}>
                      {f.ativa ? "Ativa" : "Inativa"}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-1 text-right">
                    {gestao ? (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Editar faixa"
                          onClick={() =>
                            setForm({
                              id: f.id,
                              perfil: f.perfil ?? TODOS,
                              categoria: f.categoria_id ?? TODOS,
                              marca: f.marca ?? "",
                              percentual: String(f.percentual),
                              ativa: f.ativa,
                            })
                          }
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Excluir faixa"
                          onClick={() => {
                            if (window.confirm("Excluir esta faixa de desconto?"))
                              excluir.mutate(f.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar faixa" : "Nova faixa de desconto"}</DialogTitle>
          </DialogHeader>
          {form ? (
            <div className="space-y-3">
              <div>
                <Label>Perfil de quem vende</Label>
                <Select value={form.perfil} onValueChange={(v) => setForm({ ...form, perfil: v })}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TODOS}>Todos os perfis</SelectItem>
                    {PERFIS_FAIXA.map((p) => (
                      <SelectItem key={p.valor} value={p.valor}>
                        {p.rotulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Grupo de produtos</Label>
                <Select
                  value={form.categoria}
                  onValueChange={(v) => setForm({ ...form, categoria: v })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TODOS}>Todos os grupos</SelectItem>
                    {(data?.categorias ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="fx-marca">Marca (vazio = todas)</Label>
                <Input
                  id="fx-marca"
                  className="mt-1"
                  list="fx-marcas"
                  value={form.marca}
                  onChange={(e) => setForm({ ...form, marca: e.target.value })}
                />
                <datalist id="fx-marcas">
                  {(data?.marcas ?? []).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
              <div>
                <Label htmlFor="fx-pct">Desconto máximo (%)</Label>
                <Input
                  id="fx-pct"
                  className="mt-1"
                  inputMode="decimal"
                  value={form.percentual}
                  onChange={(e) => setForm({ ...form, percentual: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="fx-ativa"
                  checked={form.ativa}
                  onCheckedChange={(v) => setForm({ ...form, ativa: v })}
                />
                <Label htmlFor="fx-ativa">Faixa ativa</Label>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            <Button onClick={() => form && salvar.mutate(form)} disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
