import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
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
import { useModulosCnae } from "@/lib/cnae";
import { brl, dateTimeBR } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/lava-lavadores")({
  head: () => ({
    meta: [
      { title: "Lavadores e comissões — EZRA ERP" },
      {
        name: "description",
        content: "Lavadores do lava rápido, percentual de comissão e aprovação do pagamento.",
      },
    ],
  }),
  component: LavadoresModulo,
});

type Form = { id?: string; nome: string; comissao_percentual: string; ativo: boolean };
const vazio: Form = { nome: "", comissao_percentual: "0", ativo: true };

const SITUACAO_COMISSAO: Record<string, string> = {
  a_aprovar: "A aprovar",
  aprovada: "Aprovada",
  paga: "Paga",
  cancelada: "Cancelada",
};

function LavadoresModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.lavarapido) return <ModuloBloqueado modulo="lavarapido" />;
  return <Lavadores />;
}

function Lavadores() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const roles = session?.roles ?? [];
  const podeEditar = roles.some((r) => ["administrador", "gestor"].includes(r));
  const verComissoes = roles.some((r) => ["administrador", "gestor", "financeiro"].includes(r));
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Form>(vazio);

  const { data, isLoading } = useQuery({
    queryKey: ["lava-lavadores"],
    queryFn: async () => {
      const [lavadores, comissoes] = await Promise.all([
        supabase.from("lr_lavadores").select("*").order("nome"),
        verComissoes
          ? supabase
              .from("lr_comissoes")
              .select("*")
              .order("created_at", { ascending: false })
              .limit(200)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (lavadores.error) throw lavadores.error;
      if (comissoes.error) throw comissoes.error;
      return { lavadores: lavadores.data ?? [], comissoes: comissoes.data ?? [] };
    },
  });
  const lavadores = data?.lavadores ?? [];
  const comissoes = data?.comissoes ?? [];
  const nomeLavador = (id: string) => lavadores.find((l) => l.id === id)?.nome ?? "—";

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim()) throw new Error("Informe o nome do lavador.");
      const pct = Number(form.comissao_percentual.replace(",", "."));
      if (!Number.isFinite(pct) || pct < 0 || pct > 100)
        throw new Error("A comissão precisa ficar entre 0 e 100%.");
      const { error } = await supabase.rpc("lr_lavador_salvar", {
        p_dados: {
          ...(form.id ? { id: form.id } : {}),
          nome: form.nome.trim(),
          comissao_percentual: pct,
          ativo: form.ativo,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(form.id ? "Lavador atualizado." : "Lavador cadastrado.");
      setAberto(false);
      setForm(vazio);
      void qc.invalidateQueries({ queryKey: ["lava-lavadores"] });
      void qc.invalidateQueries({ queryKey: ["lava-patio"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tratar = useMutation({
    mutationFn: async (p: { id: string; acao: "aprovar" | "pagar" }) => {
      const { error } =
        p.acao === "aprovar"
          ? await supabase.rpc("lr_comissao_aprovar", { p_id: p.id })
          : await supabase.rpc("lr_comissao_pagar", { p_id: p.id });
      if (error) throw error;
    },
    onSuccess: (_r, p) => {
      toast.success(p.acao === "aprovar" ? "Comissão aprovada." : "Pagamento registrado.");
      void qc.invalidateQueries({ queryKey: ["lava-lavadores"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Lavadores e comissões"
        description="A comissão é calculada sobre o valor do serviço já com o desconto da venda, quando a ordem é entregue e cobrada."
        actions={
          podeEditar ? (
            <Button
              onClick={() => {
                setForm(vazio);
                setAberto(true);
              }}
            >
              <Plus className="size-4" /> Novo lavador
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : lavadores.length === 0 ? (
        <EmptyState
          title="Nenhum lavador cadastrado"
          description="Cadastre quem lava os veículos para atribuir as ordens e calcular a comissão."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lavador</TableHead>
                <TableHead className="text-right">Comissão</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lavadores.map((l) => (
                <TableRow key={l.id} className={l.ativo ? "" : "opacity-60"}>
                  <TableCell className="font-medium">
                    {l.nome}
                    {!l.ativo && (
                      <Badge variant="outline" className="ml-2">
                        Inativo
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {Number(l.comissao_percentual).toLocaleString("pt-BR")}%
                  </TableCell>
                  <TableCell className="text-right">
                    {podeEditar && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${l.nome}`}
                        onClick={() => {
                          setForm({
                            id: l.id,
                            nome: l.nome,
                            comissao_percentual: String(l.comissao_percentual),
                            ativo: l.ativo,
                          });
                          setAberto(true);
                        }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {verComissoes && (
        <section className="mt-8">
          <h2 className="mb-3 font-display text-lg font-semibold">Comissões</h2>
          {comissoes.length === 0 ? (
            <EmptyState
              title="Nenhuma comissão ainda"
              description="Elas aparecem quando uma ordem com lavador é entregue e cobrada no caixa."
            />
          ) : (
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lavador</TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">%</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Registrada em</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comissoes.map((c) => (
                    <TableRow key={c.id} className={c.situacao === "cancelada" ? "opacity-60" : ""}>
                      <TableCell className="font-medium">{nomeLavador(c.lavador_id)}</TableCell>
                      <TableCell className="text-right">{brl(Number(c.base))}</TableCell>
                      <TableCell className="text-right">{Number(c.percentual)}%</TableCell>
                      <TableCell className="text-right">{brl(Number(c.valor))}</TableCell>
                      <TableCell>
                        <Badge variant={c.situacao === "paga" ? "secondary" : "outline"}>
                          {SITUACAO_COMISSAO[c.situacao] ?? c.situacao}
                        </Badge>
                      </TableCell>
                      <TableCell>{dateTimeBR(c.created_at)}</TableCell>
                      <TableCell className="text-right">
                        {c.situacao === "a_aprovar" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={tratar.isPending}
                            onClick={() => tratar.mutate({ id: c.id, acao: "aprovar" })}
                          >
                            Aprovar
                          </Button>
                        )}
                        {c.situacao === "aprovada" && (
                          <Button
                            size="sm"
                            disabled={tratar.isPending}
                            onClick={() => tratar.mutate({ id: c.id, acao: "pagar" })}
                          >
                            Marcar como paga
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      <Dialog open={aberto} onOpenChange={(o) => !o && setAberto(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar lavador" : "Novo lavador"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label htmlFor="lv-nome">Nome</Label>
              <Input
                id="lv-nome"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="lv-com">Comissão (%)</Label>
              <Input
                id="lv-com"
                inputMode="decimal"
                value={form.comissao_percentual}
                onChange={(e) => setForm({ ...form, comissao_percentual: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="lv-ativo"
                checked={form.ativo}
                onCheckedChange={(v) => setForm({ ...form, ativo: v })}
              />
              <Label htmlFor="lv-ativo">Ativo</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
