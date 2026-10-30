import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, MapPin, Pencil, Plus, UserRound } from "lucide-react";
import { toast } from "sonner";

import { ManufaturaBloqueada } from "@/components/app/ManufaturaBloqueada";
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
import { useManufatura } from "@/hooks/useManufatura";
import { supabase } from "@/integrations/supabase/client";
import { dateBR } from "@/lib/format";
import {
  PERFIS_APONTAMENTO,
  PERFIS_GESTAO_MANUFATURA,
  SITUACAO_ENTREGA,
  TIPO_ENTREGA,
  agruparPorDia,
  erroDoCompromisso,
  proximoPassoEntrega,
} from "@/lib/manufatura";

export const Route = createFileRoute("/_authenticated/manufatura-agenda")({
  head: () => ({
    meta: [
      { title: "Agenda de entregas — EZRA ERP" },
      {
        name: "description",
        content:
          "Entregas e instalações dos móveis sob medida: data, endereço, responsável e andamento de cada compromisso.",
      },
    ],
  }),
  component: AgendaModulo,
});

function AgendaModulo() {
  const m = useManufatura();
  if (m.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!m.liberada) return <ManufaturaBloqueada motivo="modulo" />;
  if (!m.temPerfil(PERFIS_APONTAMENTO)) return <ManufaturaBloqueada motivo="perfil" />;
  return <Agenda gestao={m.temPerfil(PERFIS_GESTAO_MANUFATURA)} />;
}

/** Dia de hoje no calendário local (não em UTC), no formato do banco. */
const hojeLocal = (somarDias = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + somarDias);
  return d.toLocaleDateString("en-CA");
};

type Form = {
  id: string | null;
  ordem_id: string;
  ordem_rotulo: string;
  ordem_tem_pedido: boolean;
  tipo: string;
  data: string;
  hora: string;
  endereco: string;
  responsavel: string;
  observacoes: string;
};
const formVazio = (): Form => ({
  id: null,
  ordem_id: "",
  ordem_rotulo: "",
  ordem_tem_pedido: false,
  tipo: "entrega_instalacao",
  data: hojeLocal(1),
  hora: "",
  endereco: "",
  responsavel: "",
  observacoes: "",
});

function Agenda({ gestao }: { gestao: boolean }) {
  const qc = useQueryClient();
  const [de, setDe] = useState(() => hojeLocal());
  const [ate, setAte] = useState(() => hojeLocal(30));
  const [form, setForm] = useState<Form | null>(null);
  const [busca, setBusca] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["mf-agenda", de, ate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("mf_entregas_agenda", { p_de: de, p_ate: ate });
      if (error) throw error;
      return data ?? [];
    },
  });

  // a ordem é buscada no servidor por número ou descrição (as 50 mais recentes sem busca): nenhuma ordem fica fora do alcance
  const termo = busca.replace(/[,()%*\\]/g, " ").trim();
  const { data: ordens } = useQuery({
    queryKey: ["mf-agenda-ordens", termo],
    enabled: gestao && form !== null && form.id === null,
    queryFn: async () => {
      let q = supabase
        .from("mf_ordens")
        .select("id, numero, descricao, pedido_id")
        .neq("situacao", "cancelada")
        .order("numero", { ascending: false })
        .limit(50);
      if (termo) {
        const n = /^\d+$/.test(termo) ? `,numero.eq.${termo}` : "";
        q = q.or(`descricao.ilike.%${termo}%${n}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const atualizar = () => void qc.invalidateQueries({ queryKey: ["mf-agenda"] });

  const salvar = useMutation({
    mutationFn: async (f: Form) => {
      const erro = erroDoCompromisso({
        ordemId: f.ordem_id,
        tipo: f.tipo,
        data: f.data,
        endereco: f.endereco,
        ordemTemPedido: f.ordem_tem_pedido,
      });
      if (erro) throw new Error(erro);
      const { error } = await supabase.rpc("mf_entrega_salvar", {
        p_dados: {
          id: f.id ?? undefined,
          ordem_id: f.ordem_id,
          tipo: f.tipo,
          data: f.data,
          hora: f.hora,
          endereco: f.endereco,
          responsavel: f.responsavel,
          observacoes: f.observacoes,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Compromisso salvo.");
      setForm(null);
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mudar = useMutation({
    mutationFn: async (v: { id: string; situacao: string }) => {
      const { error } = await supabase.rpc("mf_entrega_situacao", {
        p_id: v.id,
        p_situacao: v.situacao,
      });
      if (error) throw error;
    },
    onSuccess: atualizar,
    onError: (e: Error) => toast.error(e.message),
  });

  const grupos = agruparPorDia(data ?? []);

  return (
    <div>
      <PageHeader
        title="Agenda de entregas"
        description="Entregas e instalações dos móveis sob medida, por dia."
        actions={
          gestao ? (
            <Button
              onClick={() => {
                setBusca("");
                setForm(formVazio());
              }}
            >
              <Plus className="mr-2 size-4" /> Novo compromisso
            </Button>
          ) : undefined
        }
      />

      <div className="panel mb-4 grid gap-3 p-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="ag-de">De</Label>
          <Input id="ag-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ag-ate">Até</Label>
          <Input id="ag-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>
      </div>

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : isError ? (
        <EmptyState
          title="Não foi possível carregar a agenda"
          description="Confira o período (até um ano) e a conexão."
          action={<Button onClick={() => void refetch()}>Tentar de novo</Button>}
        />
      ) : grupos.length === 0 ? (
        <EmptyState
          title="Nenhum compromisso no período"
          description={
            gestao
              ? "Agende a entrega ou a instalação de uma ordem de produção."
              : "A gestão agenda as entregas e instalações."
          }
        />
      ) : (
        <div className="grid gap-5">
          {grupos.map((g) => (
            <section key={g.data}>
              <h2 className="mb-2 flex items-center gap-2 font-display text-sm font-semibold">
                <CalendarDays className="size-4" /> {dateBR(g.data)}
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {g.itens.map((c) => {
                  const passo = proximoPassoEntrega(c.situacao);
                  return (
                    <div key={c.id} className="panel flex flex-col gap-2 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-display text-base font-semibold">
                            {c.hora ? `${c.hora.slice(0, 5)} · ` : ""}
                            {TIPO_ENTREGA[c.tipo] ?? c.tipo}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            OP-{c.ordem_numero} · {c.descricao}
                            {c.cliente ? ` · ${c.cliente}` : ""}
                          </p>
                        </div>
                        <Badge
                          variant={
                            c.situacao === "concluida" || c.situacao === "em_andamento"
                              ? "default"
                              : "secondary"
                          }
                        >
                          {SITUACAO_ENTREGA[c.situacao] ?? c.situacao}
                        </Badge>
                      </div>
                      <p className="flex items-start gap-1.5 text-sm">
                        <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        {c.endereco}
                      </p>
                      {c.responsavel && (
                        <p className="flex items-center gap-1.5 text-sm">
                          <UserRound className="size-4 shrink-0 text-muted-foreground" />
                          {c.responsavel}
                        </p>
                      )}
                      {c.observacoes && (
                        <p className="text-xs text-muted-foreground">{c.observacoes}</p>
                      )}
                      {passo && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Button
                            size="sm"
                            onClick={() => mudar.mutate({ id: c.id, situacao: passo.para })}
                            disabled={mudar.isPending}
                          >
                            {passo.rotulo}
                          </Button>
                          {gestao && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setForm({
                                    id: c.id,
                                    ordem_id: c.ordem_id,
                                    ordem_rotulo: `OP-${c.ordem_numero} · ${c.descricao}`,
                                    ordem_tem_pedido: false,
                                    tipo: c.tipo,
                                    data: c.data,
                                    hora: c.hora ? c.hora.slice(0, 5) : "",
                                    endereco: c.endereco,
                                    responsavel: c.responsavel ?? "",
                                    observacoes: c.observacoes ?? "",
                                  })
                                }
                              >
                                <Pencil className="mr-1.5 size-3.5" /> Reagendar
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => mudar.mutate({ id: c.id, situacao: "cancelada" })}
                                disabled={mudar.isPending}
                              >
                                Cancelar
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Reagendar compromisso" : "Novo compromisso"}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ag-ordem">Ordem de produção</Label>
                {form.id === null && (
                  <Input
                    aria-label="Buscar ordem por número ou descrição"
                    placeholder="Buscar por número ou descrição"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                  />
                )}
                <Select
                  value={form.ordem_id}
                  onValueChange={(v) => {
                    const o = ordens?.find((x) => x.id === v);
                    setForm({
                      ...form,
                      ordem_id: v,
                      ordem_rotulo: o ? `OP-${o.numero} · ${o.descricao}` : form.ordem_rotulo,
                      ordem_tem_pedido: Boolean(o?.pedido_id),
                    });
                  }}
                  disabled={form.id !== null}
                >
                  <SelectTrigger id="ag-ordem">
                    <SelectValue placeholder="Escolha a ordem">
                      {form.ordem_rotulo || undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(ordens ?? []).map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        OP-{o.numero} · {o.descricao}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ag-tipo">Tipo</Label>
                <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                  <SelectTrigger id="ag-tipo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TIPO_ENTREGA).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="ag-data">Data</Label>
                  <Input
                    id="ag-data"
                    type="date"
                    value={form.data}
                    onChange={(e) => setForm({ ...form, data: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ag-hora">Hora (opcional)</Label>
                  <Input
                    id="ag-hora"
                    type="time"
                    value={form.hora}
                    onChange={(e) => setForm({ ...form, hora: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ag-end">Endereço</Label>
                <Input
                  id="ag-end"
                  value={form.endereco}
                  placeholder="Vazio: usa o endereço de entrega do pedido"
                  onChange={(e) => setForm({ ...form, endereco: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ag-resp">Responsável (opcional)</Label>
                <Input
                  id="ag-resp"
                  value={form.responsavel}
                  placeholder="Equipe ou pessoa"
                  onChange={(e) => setForm({ ...form, responsavel: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ag-obs">Observações (opcional)</Label>
                <Input
                  id="ag-obs"
                  value={form.observacoes}
                  onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            <Button onClick={() => form && salvar.mutate(form)} disabled={salvar.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
