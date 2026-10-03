import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/format";
import { SITUACAO_SAAS, useSaasDados, useSaasOperador, type PlanoSaas } from "@/lib/saas";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/ze-tech-planos")({
  head: () => ({
    meta: [
      { title: "Planos da Ze Tech — custo e prazo" },
      {
        name: "description",
        content:
          "Defina cada plano do ERP Ze Tech: valor mensal, prazo, teste grátis, filial extra e implantação, e veja quem assina cada um.",
      },
      { property: "og:title", content: "Planos da Ze Tech — custo e prazo" },
      {
        property: "og:description",
        content: "Catálogo de planos, valores e clientes ativos em cada plano.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PlanosZeTech,
});

type Form = {
  codigo: string;
  nome: string;
  resumo: string;
  valor_mensal: string;
  prazo_meses: string;
  dias_teste: string;
  valor_filial_extra: string;
  valor_implantacao: string;
  recursos: string;
  ordem: string;
  ativo: boolean;
};

const vazio: Form = {
  codigo: "",
  nome: "",
  resumo: "",
  valor_mensal: "0",
  prazo_meses: "12",
  dias_teste: "0",
  valor_filial_extra: "390",
  valor_implantacao: "1500",
  recursos: "",
  ordem: "9",
  ativo: true,
};

function PlanosZeTech() {
  const qc = useQueryClient();
  const { data: operador, isLoading: carregandoAcesso } = useSaasOperador();
  const { data } = useSaasDados(operador === true);
  const [form, setForm] = useState<Form>(vazio);
  const [editando, setEditando] = useState<PlanoSaas | null>(null);
  const [aberto, setAberto] = useState(false);

  const planos = data?.planos ?? [];
  const resumos = data?.resumos ?? [];

  function abrirNovo() {
    setEditando(null);
    setForm(vazio);
    setAberto(true);
  }

  function abrirEdicao(p: PlanoSaas) {
    setEditando(p);
    setForm({
      codigo: p.codigo,
      nome: p.nome,
      resumo: p.resumo ?? "",
      valor_mensal: String(p.valor_mensal),
      prazo_meses: String(p.prazo_meses),
      dias_teste: String(p.dias_teste),
      valor_filial_extra: String(p.valor_filial_extra),
      valor_implantacao: String(p.valor_implantacao),
      recursos: (p.recursos ?? []).join("\n"),
      ordem: String(p.ordem),
      ativo: p.ativo,
    });
    setAberto(true);
  }

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim()) throw new Error("Informe o nome do plano.");
      const codigo =
        form.codigo.trim() ||
        form.nome
          .trim()
          .toLowerCase()
          .normalize("NFD")
          .replace(/[^a-z0-9]+/g, "_");
      const num = (v: string) => Number(v.replace(",", ".")) || 0;
      const payload = {
        codigo,
        nome: form.nome.trim(),
        resumo: form.resumo.trim() || null,
        valor_mensal: num(form.valor_mensal),
        prazo_meses: Number(form.prazo_meses) || 12,
        dias_teste: Number(form.dias_teste) || 0,
        valor_filial_extra: num(form.valor_filial_extra),
        valor_implantacao: num(form.valor_implantacao),
        recursos: form.recursos
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
        ordem: Number(form.ordem) || 9,
        ativo: form.ativo,
      };
      const res = editando
        ? await supabase.from("saas_planos").update(payload).eq("id", editando.id)
        : await supabase.from("saas_planos").insert(payload);
      if (res.error) throw res.error;
    },
    onSuccess: () => {
      toast.success(editando ? "Plano atualizado." : "Plano criado.");
      setAberto(false);
      void qc.invalidateQueries({ queryKey: ["saas-dados"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (carregandoAcesso) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  if (!operador)
    return (
      <EmptyState
        title="Área exclusiva da Ze Tech"
        description="Só a equipe Ze Tech define os planos comercializados."
      />
    );

  return (
    <>
      <PageHeader
        title="Planos da Ze Tech"
        description="Defina valor, prazo, teste grátis, filial extra e implantação de cada plano."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/ze-tech">Painel de clientes</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/ze-tech-relatorios">Relatórios</Link>
            </Button>
            <Button onClick={abrirNovo}>
              <Plus className="size-4" /> Novo plano
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-3 lg:grid-cols-3">
        {planos.map((p) => {
          const assinantes = resumos.filter((r) => r.cliente.plano_id === p.id);
          const pagos = assinantes.filter((r) => r.status === "pago").length;
          return (
            <div key={p.id} className="panel flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display text-lg font-bold">{p.nome}</p>
                  <p className="text-xs text-muted-foreground">{p.resumo ?? "—"}</p>
                </div>
                <Badge variant={p.ativo ? "default" : "secondary"}>
                  {p.ativo ? "Ativo" : "Inativo"}
                </Badge>
              </div>
              <p className="font-display text-2xl font-bold">
                {brl(p.valor_mensal)}
                <span className="text-sm font-normal text-muted-foreground">/mês</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Prazo {p.prazo_meses} meses ·{" "}
                {p.dias_teste > 0 ? `${p.dias_teste} dias de teste` : "sem teste"} · filial extra{" "}
                {brl(p.valor_filial_extra)} · implantação {brl(p.valor_implantacao)}
              </p>
              <ul className="grid gap-1 text-sm">
                {(p.recursos ?? []).map((r) => (
                  <li key={r} className="text-muted-foreground">
                    • {r}
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3 text-sm">
                <span>
                  <strong>{assinantes.length}</strong> cliente(s) · {pagos} em dia
                </span>
                <Button variant="outline" size="sm" onClick={() => abrirEdicao(p)}>
                  Editar
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="panel overflow-x-auto">
        <p className="p-4 font-display text-sm font-semibold">Clientes por plano</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-52">Cliente</TableHead>
              <TableHead className="w-28">Plano</TableHead>
              <TableHead className="w-32 text-center">Situação</TableHead>
              <TableHead className="w-28 text-right">Mensal</TableHead>
              <TableHead className="w-32 text-right">Em aberto</TableHead>
              <TableHead className="w-28 text-center">Pagamento</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {resumos.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Nenhum cliente cadastrado.
                </TableCell>
              </TableRow>
            ) : (
              resumos.map((r) => (
                <TableRow key={r.cliente.id} className="align-middle">
                  <TableCell className="font-medium">{r.cliente.nome}</TableCell>
                  <TableCell>{r.plano?.nome ?? "—"}</TableCell>
                  <TableCell className="text-center">
                    {SITUACAO_SAAS[r.cliente.situacao] ?? r.cliente.situacao}
                  </TableCell>
                  <TableCell className="text-right">{brl(r.mensal)}</TableCell>
                  <TableCell className="text-right">{brl(r.aberto)}</TableCell>
                  <TableCell className="text-center">
                    {r.status === "pago" ? (
                      <Badge>Pago</Badge>
                    ) : r.status === "atrasado" ? (
                      <Badge variant="destructive">Em atraso</Badge>
                    ) : (
                      <Badge variant="secondary">Em aberto</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editando ? `Editar plano ${editando.nome}` : "Novo plano"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="p-nome">Nome</Label>
              <Input
                id="p-nome"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-codigo">Código interno</Label>
              <Input
                id="p-codigo"
                value={form.codigo}
                onChange={(e) => setForm({ ...form, codigo: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="p-resumo">Resumo</Label>
              <Input
                id="p-resumo"
                value={form.resumo}
                onChange={(e) => setForm({ ...form, resumo: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-valor">Valor mensal (R$)</Label>
              <Input
                id="p-valor"
                inputMode="decimal"
                value={form.valor_mensal}
                onChange={(e) => setForm({ ...form, valor_mensal: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-prazo">Prazo (meses)</Label>
              <Input
                id="p-prazo"
                inputMode="numeric"
                value={form.prazo_meses}
                onChange={(e) => setForm({ ...form, prazo_meses: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-teste">Dias de teste grátis</Label>
              <Input
                id="p-teste"
                inputMode="numeric"
                value={form.dias_teste}
                onChange={(e) => setForm({ ...form, dias_teste: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-filial">Filial extra (R$/mês)</Label>
              <Input
                id="p-filial"
                inputMode="decimal"
                value={form.valor_filial_extra}
                onChange={(e) => setForm({ ...form, valor_filial_extra: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-impl">Implantação (R$)</Label>
              <Input
                id="p-impl"
                inputMode="decimal"
                value={form.valor_implantacao}
                onChange={(e) => setForm({ ...form, valor_implantacao: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-ordem">Ordem na vitrine</Label>
              <Input
                id="p-ordem"
                inputMode="numeric"
                value={form.ordem}
                onChange={(e) => setForm({ ...form, ordem: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="p-recursos">Recursos (um por linha)</Label>
              <Textarea
                id="p-recursos"
                rows={5}
                value={form.recursos}
                onChange={(e) => setForm({ ...form, recursos: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch
                id="p-ativo"
                checked={form.ativo}
                onCheckedChange={(v) => setForm({ ...form, ativo: v })}
              />
              <Label htmlFor="p-ativo">Plano disponível para venda</Label>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              Salvar plano
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
