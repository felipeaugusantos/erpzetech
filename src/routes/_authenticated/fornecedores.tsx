import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, History, Pencil, Plus, Search, Trophy } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, dateBR, num } from "@/lib/format";
import { diasDePrazo } from "@/lib/cotacao";
import { labelCompra } from "@/lib/financeiro";
import { PageHeader, EmptyState, StatCard } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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

export const Route = createFileRoute("/_authenticated/fornecedores")({
  head: () => ({
    meta: [
      { title: "Fornecedores — ERP Ze Tech" },
      {
        name: "description",
        content: "Cadastro de fornecedores com contato, prazo de entrega e histórico de compras.",
      },
      { property: "og:title", content: "Fornecedores — ERP Ze Tech" },
      { property: "og:description", content: "Fornecedores da loja de materiais de construção." },
    ],
  }),
  component: Fornecedores,
});

type Form = {
  id?: string;
  razao_social: string;
  nome_fantasia: string;
  cnpj: string;
  contato: string;
  telefone: string;
  whatsapp: string;
  email: string;
  cidade: string;
  estado: string;
  prazo_entrega_dias: string;
  condicao_pagamento: string;
  ativo: boolean;
};

const vazio: Form = {
  razao_social: "",
  nome_fantasia: "",
  cnpj: "",
  contato: "",
  telefone: "",
  whatsapp: "",
  email: "",
  cidade: "",
  estado: "",
  prazo_entrega_dias: "0",
  condicao_pagamento: "",
  ativo: true,
};

function Fornecedores() {
  const { data: session } = useSessionData();
  const tenantId = session?.profile?.tenant_id ?? null;
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Form>(vazio);
  const [historicoId, setHistoricoId] = useState<string | null>(null);

  const { data: historico } = useQuery({
    queryKey: ["fornecedor-historico", historicoId],
    enabled: Boolean(historicoId),
    queryFn: async () => {
      const [comprasRes, cotacoesRes] = await Promise.all([
        supabase
          .from("compras")
          .select(
            "id, numero, situacao, total, created_at, previsao_entrega, condicao_pagamento, compra_itens(quantidade, unidade, custo_unitario, produtos(descricao, codigo_interno))",
          )
          .eq("fornecedor_id", historicoId!)
          .order("numero", { ascending: false })
          .limit(20),
        supabase
          .from("compra_cotacoes")
          .select(
            "id, valor_total, prazo_entrega_dias, condicao_pagamento, escolhida, created_at, compras(numero)",
          )
          .eq("fornecedor_id", historicoId!)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      if (comprasRes.error) throw comprasRes.error;
      if (cotacoesRes.error) throw cotacoesRes.error;
      return { compras: comprasRes.data, cotacoes: cotacoesRes.data };
    },
  });

  const { data: fornecedores = [], isLoading } = useQuery({
    queryKey: ["fornecedores"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fornecedores").select("*").order("razao_social");
      if (error) throw error;
      return data;
    },
  });

  const { data: compras = [] } = useQuery({
    queryKey: ["compras-por-fornecedor"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compras")
        .select("fornecedor_id, total, situacao")
        .neq("situacao", "cancelado");
      if (error) throw error;
      return data;
    },
  });

  const resumo = useMemo(() => {
    const mapa = new Map<string, { qtd: number; total: number }>();
    for (const c of compras) {
      if (!c.fornecedor_id) continue;
      const atual = mapa.get(c.fornecedor_id) ?? { qtd: 0, total: 0 };
      atual.qtd += 1;
      atual.total += Number(c.total ?? 0);
      mapa.set(c.fornecedor_id, atual);
    }
    return mapa;
  }, [compras]);

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return fornecedores;
    return fornecedores.filter((f) =>
      [f.razao_social, f.nome_fantasia, f.cnpj, f.cidade, f.contato]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(t)),
    );
  }, [fornecedores, busca]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("Usuário sem empresa vinculada");
      if (!form.razao_social.trim()) throw new Error("Informe a razão social");
      const payload = {
        tenant_id: tenantId,
        razao_social: form.razao_social.trim(),
        nome_fantasia: form.nome_fantasia || null,
        cnpj: form.cnpj || null,
        contato: form.contato || null,
        telefone: form.telefone || null,
        whatsapp: form.whatsapp || null,
        email: form.email || null,
        cidade: form.cidade || null,
        estado: form.estado || null,
        prazo_entrega_dias: Number(form.prazo_entrega_dias || 0),
        condicao_pagamento: form.condicao_pagamento || null,
        ativo: form.ativo,
      };
      if (form.id) {
        const { error } = await supabase.from("fornecedores").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("fornecedores").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(form.id ? "Fornecedor atualizado." : "Fornecedor cadastrado.");
      setAberto(false);
      setForm(vazio);
      void queryClient.invalidateQueries({ queryKey: ["fornecedores"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalCompras = compras.reduce((s, c) => s + Number(c.total ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Fornecedores"
        description="Quem abastece a loja, com contato, prazo e histórico de compras."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/cotacoes">
                <Trophy className="size-4" /> Cotações
              </Link>
            </Button>
            <Button
              onClick={() => {
                setForm(vazio);
                setAberto(true);
              }}
            >
              <Plus className="size-4" /> Novo fornecedor
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Fornecedores" value={String(fornecedores.length)} icon={Building2} />
        <StatCard
          label="Ativos"
          value={String(fornecedores.filter((f) => f.ativo).length)}
          tone="success"
        />
        <StatCard label="Total comprado" value={brl(totalCompras)} tone="accent" />
      </div>

      <div className="panel mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome, CNPJ, cidade ou contato"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhum fornecedor encontrado."
          description="Cadastre os fornecedores para começar a comprar."
          action={
            <Button
              onClick={() => {
                setForm(vazio);
                setAberto(true);
              }}
            >
              <Plus className="size-4" /> Novo fornecedor
            </Button>
          }
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Contato</TableHead>
                <TableHead>Cidade</TableHead>
                <TableHead className="text-right">Prazo</TableHead>
                <TableHead className="text-right">Compras</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((f) => {
                const r = resumo.get(f.id);
                return (
                  <TableRow key={f.id}>
                    <TableCell>
                      <p className="font-medium">{f.razao_social}</p>
                      <p className="text-xs text-muted-foreground">
                        {f.nome_fantasia ?? "—"} {f.cnpj ? `· ${f.cnpj}` : ""}
                      </p>
                      {!f.ativo && (
                        <Badge className="mt-1 bg-secondary text-secondary-foreground">
                          Inativo
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {f.contato ?? "—"}
                      <p className="text-xs text-muted-foreground">{f.telefone ?? f.email ?? ""}</p>
                    </TableCell>
                    <TableCell className="text-sm">
                      {f.cidade ?? "—"}
                      {f.estado ? `/${f.estado}` : ""}
                    </TableCell>
                    <TableCell className="text-right text-numeric">
                      {f.prazo_entrega_dias ?? 0} d
                    </TableCell>
                    <TableCell className="text-right text-numeric">{r?.qtd ?? 0}</TableCell>
                    <TableCell className="text-right text-numeric">{brl(r?.total ?? 0)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setHistoricoId(f.id)}
                        title="Histórico e cotações"
                      >
                        <History className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setForm({
                            id: f.id,
                            razao_social: f.razao_social,
                            nome_fantasia: f.nome_fantasia ?? "",
                            cnpj: f.cnpj ?? "",
                            contato: f.contato ?? "",
                            telefone: f.telefone ?? "",
                            whatsapp: f.whatsapp ?? "",
                            email: f.email ?? "",
                            cidade: f.cidade ?? "",
                            estado: f.estado ?? "",
                            prazo_entrega_dias: String(f.prazo_entrega_dias ?? 0),
                            condicao_pagamento: f.condicao_pagamento ?? "",
                            ativo: f.ativo,
                          });
                          setAberto(true);
                        }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar fornecedor" : "Novo fornecedor"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Razão social</Label>
              <Input
                value={form.razao_social}
                onChange={(e) => setForm({ ...form, razao_social: e.target.value })}
              />
            </div>
            <div>
              <Label>Nome fantasia</Label>
              <Input
                value={form.nome_fantasia}
                onChange={(e) => setForm({ ...form, nome_fantasia: e.target.value })}
              />
            </div>
            <div>
              <Label>CNPJ</Label>
              <Input
                value={form.cnpj}
                onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
              />
            </div>
            <div>
              <Label>Contato</Label>
              <Input
                value={form.contato}
                onChange={(e) => setForm({ ...form, contato: e.target.value })}
              />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input
                value={form.telefone}
                onChange={(e) => setForm({ ...form, telefone: e.target.value })}
              />
            </div>
            <div>
              <Label>WhatsApp</Label>
              <Input
                value={form.whatsapp}
                onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
              />
            </div>
            <div>
              <Label>E-mail</Label>
              <Input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <Label>Cidade</Label>
              <Input
                value={form.cidade}
                onChange={(e) => setForm({ ...form, cidade: e.target.value })}
              />
            </div>
            <div>
              <Label>Estado</Label>
              <Input
                maxLength={2}
                value={form.estado}
                onChange={(e) => setForm({ ...form, estado: e.target.value.toUpperCase() })}
              />
            </div>
            <div>
              <Label>Prazo de entrega (dias)</Label>
              <Input
                inputMode="numeric"
                value={form.prazo_entrega_dias}
                onChange={(e) => setForm({ ...form, prazo_entrega_dias: e.target.value })}
              />
            </div>
            <div>
              <Label>Condição de pagamento</Label>
              <Input
                placeholder="Ex.: 28 dias"
                value={form.condicao_pagamento}
                onChange={(e) => setForm({ ...form, condicao_pagamento: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch
                checked={form.ativo}
                onCheckedChange={(v) => setForm({ ...form, ativo: v })}
                id="ativo"
              />
              <Label htmlFor="ativo">Fornecedor ativo</Label>
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

      <Dialog open={Boolean(historicoId)} onOpenChange={(v) => !v && setHistoricoId(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {fornecedores.find((f) => f.id === historicoId)?.razao_social ?? "Fornecedor"} —
              histórico
            </DialogTitle>
          </DialogHeader>

          {!historico ? (
            <p className="py-6 text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <StatCard
                  label="Compras"
                  value={String(historico.compras.length)}
                  hint="últimas 20"
                />
                <StatCard
                  label="Total comprado"
                  value={brl(historico.compras.reduce((s, c) => s + Number(c.total ?? 0), 0))}
                  tone="accent"
                />
                <StatCard
                  label="Prazo médio de pagamento"
                  value={`${num(
                    historico.cotacoes.length
                      ? historico.cotacoes.reduce(
                          (s, c) => s + diasDePrazo(c.condicao_pagamento),
                          0,
                        ) / historico.cotacoes.length
                      : diasDePrazo(
                          fornecedores.find((f) => f.id === historicoId)?.condicao_pagamento ?? "",
                        ),
                    0,
                  )} dias`}
                />
              </div>

              <div>
                <h3 className="mb-2 font-display font-semibold">Propostas enviadas</h3>
                {historico.cotacoes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma proposta registrada.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Compra</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead className="text-right">Entrega</TableHead>
                        <TableHead>Pagamento</TableHead>
                        <TableHead>Data</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historico.cotacoes.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell>
                            #
                            {String((c.compras as { numero: number } | null)?.numero ?? 0).padStart(
                              4,
                              "0",
                            )}
                            {c.escolhida && (
                              <Badge className="ml-2 bg-success/15 text-success">Fechada</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-numeric">
                            {brl(Number(c.valor_total))}
                          </TableCell>
                          <TableCell className="text-right text-numeric">
                            {c.prazo_entrega_dias ?? 0} d
                          </TableCell>
                          <TableCell className="text-sm">{c.condicao_pagamento ?? "—"}</TableCell>
                          <TableCell className="text-sm">{dateBR(c.created_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div>
                <h3 className="mb-2 font-display font-semibold">Compras</h3>
                {historico.compras.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma compra com este fornecedor.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Compra</TableHead>
                        <TableHead>Situação</TableHead>
                        <TableHead>Previsão</TableHead>
                        <TableHead>Pagamento</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historico.compras.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell>
                            <Link
                              to="/compras/$id"
                              params={{ id: c.id }}
                              className="font-medium text-primary hover:underline"
                              onClick={() => setHistoricoId(null)}
                            >
                              #{String(c.numero).padStart(4, "0")}
                            </Link>
                            <p className="text-xs text-muted-foreground">{dateBR(c.created_at)}</p>
                          </TableCell>
                          <TableCell className="text-sm">{labelCompra(c.situacao)}</TableCell>
                          <TableCell className="text-sm">
                            {c.previsao_entrega ? dateBR(c.previsao_entrega) : "—"}
                          </TableCell>
                          <TableCell className="text-sm">{c.condicao_pagamento ?? "—"}</TableCell>
                          <TableCell className="text-right text-numeric">
                            {brl(Number(c.total ?? 0))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div>
                <h3 className="mb-2 font-display font-semibold">Últimos preços praticados</h3>
                {(() => {
                  const precos = new Map<
                    string,
                    {
                      descricao: string;
                      codigo: string;
                      unidade: string;
                      custo: number;
                      data: string;
                    }
                  >();
                  for (const c of historico.compras) {
                    for (const i of (c.compra_itens ?? []) as unknown as {
                      quantidade: number;
                      unidade: string | null;
                      custo_unitario: number;
                      produtos: { descricao: string; codigo_interno: string } | null;
                    }[]) {
                      const chave = i.produtos?.codigo_interno ?? i.produtos?.descricao ?? "";
                      if (!chave || precos.has(chave)) continue;
                      precos.set(chave, {
                        descricao: i.produtos?.descricao ?? "—",
                        codigo: i.produtos?.codigo_interno ?? "",
                        unidade: i.unidade ?? "",
                        custo: Number(i.custo_unitario),
                        data: c.created_at,
                      });
                    }
                  }
                  const lista = [...precos.values()];
                  if (lista.length === 0)
                    return (
                      <p className="text-sm text-muted-foreground">
                        Nenhum produto comprado deste fornecedor ainda.
                      </p>
                    );
                  return (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Produto</TableHead>
                          <TableHead className="text-right">Último custo</TableHead>
                          <TableHead>Data</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lista.map((p) => (
                          <TableRow key={p.codigo + p.descricao}>
                            <TableCell>
                              <p className="font-medium">{p.descricao}</p>
                              <p className="text-numeric text-xs text-muted-foreground">
                                {p.codigo} {p.unidade ? `· ${p.unidade}` : ""}
                              </p>
                            </TableCell>
                            <TableCell className="text-right text-numeric">
                              {brl(p.custo)}
                            </TableCell>
                            <TableCell className="text-sm">{dateBR(p.data)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  );
                })()}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoricoId(null)}>
              Fechar
            </Button>
            <Button asChild>
              <Link to="/cotacoes">Cotar com este fornecedor</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
