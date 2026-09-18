import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Building2, Check, CircleDollarSign, Receipt, Wallet } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, dateBR } from "@/lib/format";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/planos")({
  head: () => ({
    meta: [
      { title: "Plano e assinatura — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Plano contratado, mensalidade, filiais extras, implantação, o que já foi pago e o que falta.",
      },
      { property: "og:title", content: "Plano e assinatura — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Acompanhe a assinatura do ERP Ze Tech, pagamentos e valores em aberto.",
      },
    ],
  }),
  component: Planos,
});

type Plano = {
  id: "balcao" | "loja" | "rede";
  nome: string;
  valor: number;
  resumo: string;
  itens: string[];
  teste: boolean;
};

const PLANOS: Plano[] = [
  {
    id: "balcao",
    nome: "Balcão",
    valor: 149,
    resumo: "1 loja, 1 depósito, 5 usuários",
    teste: false,
    itens: ["Clientes e obras", "Produtos e estoque", "Orçamento", "Pedidos"],
  },
  {
    id: "loja",
    nome: "Loja",
    valor: 299,
    resumo: "1 loja, depósitos ilimitados, 15 usuários",
    teste: true,
    itens: [
      "Tudo do Balcão",
      "Compras com cotação",
      "Separação e conferência",
      "Entregas",
      "Financeiro completo",
      "NF-e",
    ],
  },
  {
    id: "rede",
    nome: "Rede",
    valor: 599,
    resumo: "Multiempresa e filiais, usuários ilimitados",
    teste: true,
    itens: [
      "Tudo do Loja",
      "Roteirização automática",
      "Tela do motorista",
      "Custo por depósito",
      "Balanço fiscal",
      "Relatórios gerenciais",
    ],
  },
];

const TIPO_LABEL: Record<string, string> = {
  mensalidade: "Mensalidade",
  filial_extra: "Filial extra",
  implantacao: "Implantação",
};

const SITUACAO_LABEL: Record<string, string> = {
  teste: "Em teste grátis",
  ativa: "Ativa",
  inadimplente: "Pagamento em atraso",
  cancelada: "Cancelada",
};

function Planos() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const podeEditar =
    session?.roles.some((r) => ["administrador", "gestor"].includes(r)) ?? false;

  const { data, isLoading } = useQuery({
    queryKey: ["assinatura"],
    queryFn: async () => {
      // gera automaticamente a mensalidade e as filiais extras do mês (sem lançamento manual)
      await supabase.rpc("gerar_faturas_assinatura");
      const [assinaturaRes, faturasRes] = await Promise.all([
        supabase.from("assinaturas").select("*").maybeSingle(),
        supabase.from("assinatura_faturas").select("*").order("vencimento", { ascending: false }),
      ]);
      return { assinatura: assinaturaRes.data ?? null, faturas: faturasRes.data ?? [] };
    },
  });

  const { data: contatos } = useQuery({
    queryKey: ["contatos"],
    queryFn: async () => {
      const { data } = await supabase
        .from("contatos")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);
      return data ?? [];
    },
  });

  const assinatura = data?.assinatura ?? null;
  const faturas = data?.faturas ?? [];

  const resumo = useMemo(() => {
    const hoje = new Date().toISOString().slice(0, 10);
    let pago = 0;
    let aberto = 0;
    let vencido = 0;
    for (const f of faturas) {
      const valor = Number(f.valor);
      const val_pago = Number(f.valor_pago);
      pago += val_pago;
      const falta = Math.max(valor - val_pago, 0);
      aberto += falta;
      if (falta > 0 && f.vencimento < hoje) vencido += falta;
    }
    return { pago, aberto, vencido };
  }, [faturas]);

  const mensalTotal = assinatura
    ? Number(assinatura.valor_mensal) +
      Number(assinatura.filiais_extras) * Number(assinatura.valor_filial_extra)
    : 0;

  const planoAtual = PLANOS.find((p) => p.id === assinatura?.plano) ?? null;

  /* ---------- editar assinatura ---------- */
  const [editar, setEditar] = useState(false);
  const [form, setForm] = useState({ plano: "loja", filiais_extras: "0", dia_vencimento: "10" });

  function abrirEdicao() {
    if (!assinatura) return;
    setForm({
      plano: assinatura.plano,
      filiais_extras: String(assinatura.filiais_extras),
      dia_vencimento: String(assinatura.dia_vencimento),
    });
    setEditar(true);
  }

  const salvar = useMutation({
    mutationFn: async () => {
      if (!assinatura) throw new Error("Assinatura não encontrada");
      const plano = PLANOS.find((p) => p.id === form.plano);
      const { error } = await supabase
        .from("assinaturas")
        .update({
          plano: form.plano,
          valor_mensal: plano?.valor ?? Number(assinatura.valor_mensal),
          filiais_extras: Math.max(Number(form.filiais_extras) || 0, 0),
          dia_vencimento: Math.min(Math.max(Number(form.dia_vencimento) || 10, 1), 28),
        })
        .eq("id", assinatura.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Plano atualizado");
      setEditar(false);
      qc.invalidateQueries({ queryKey: ["assinatura"] });
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  /* ---------- implantação de filial extra ---------- */
  const [implantacao, setImplantacao] = useState(false);
  const [filialNome, setFilialNome] = useState("");

  const cobrarImplantacao = useMutation({
    mutationFn: async () => {
      if (!assinatura) throw new Error("Assinatura não encontrada");
      if (filialNome.trim().length < 2) throw new Error("Informe o nome da filial");
      const venc = new Date();
      venc.setDate(venc.getDate() + 10);
      const { error } = await supabase.from("assinatura_faturas").insert({
        tenant_id: assinatura.tenant_id,
        assinatura_id: assinatura.id,
        tipo: "implantacao",
        descricao: `Implantação da filial extra: ${filialNome.trim()}`,
        competencia: new Date().toISOString().slice(0, 10),
        valor: Number(assinatura.valor_implantacao),
        vencimento: venc.toISOString().slice(0, 10),
      });
      if (error) throw error;
      const { error: err2 } = await supabase
        .from("assinaturas")
        .update({ filiais_extras: Number(assinatura.filiais_extras) + 1 })
        .eq("id", assinatura.id);
      if (err2) throw err2;
    },
    onSuccess: () => {
      toast.success("Implantação da filial extra lançada");
      setImplantacao(false);
      setFilialNome("");
      qc.invalidateQueries({ queryKey: ["assinatura"] });
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  /* ---------- registrar pagamento ---------- */
  const [pagar, setPagar] = useState<(typeof faturas)[number] | null>(null);
  const [valorPago, setValorPago] = useState("");
  const [forma, setForma] = useState("pix");

  const registrarPagamento = useMutation({
    mutationFn: async () => {
      if (!pagar) return;
      const restante = Number(pagar.valor) - Number(pagar.valor_pago);
      const valor = Number(valorPago.replace(",", ".")) || restante;
      if (valor <= 0) throw new Error("Informe um valor maior que zero");
      const total = Number(pagar.valor_pago) + valor;
      const quitada = total >= Number(pagar.valor) - 0.005;
      const { error } = await supabase
        .from("assinatura_faturas")
        .update({
          valor_pago: total,
          forma_pagamento: forma,
          ...(quitada ? { pago_em: new Date().toISOString().slice(0, 10) } : {}),
        })
        .eq("id", pagar.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pagamento registrado");
      setPagar(null);
      setValorPago("");
      qc.invalidateQueries({ queryKey: ["assinatura"] });
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  return (
    <>
      <PageHeader
        title="Plano e assinatura"
        description="Plano contratado, mensalidade, filiais extras, implantação, o que já foi pago e o que falta."
        actions={
          podeEditar && assinatura ? (
            <>
              <Button variant="outline" onClick={() => setImplantacao(true)}>
                <Building2 className="mr-2 size-4" /> Implantar filial extra
              </Button>
              <Button onClick={abrirEdicao}>Alterar plano</Button>
            </>
          ) : null
        }
      />

      {isLoading ? (
        <div className="panel h-52 animate-pulse" />
      ) : !assinatura ? (
        <EmptyState
          title="Nenhuma assinatura cadastrada."
          description="Assim que o plano for contratado, os valores e pagamentos aparecem aqui."
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Plano atual"
              value={planoAtual?.nome ?? assinatura.plano}
              hint={`${brl(Number(assinatura.valor_mensal))}/mês · ${planoAtual?.resumo ?? ""}`}
              icon={CircleDollarSign}
              tone="accent"
            />
            <StatCard
              label="Total mensal"
              value={brl(mensalTotal)}
              hint={`${assinatura.filiais_extras} filial(is) extra × ${brl(Number(assinatura.valor_filial_extra))}`}
              icon={Wallet}
            />
            <StatCard
              label="Já pago"
              value={brl(resumo.pago)}
              hint="Soma de tudo que foi quitado"
              icon={Check}
              tone="success"
            />
            <StatCard
              label="Falta pagar"
              value={brl(resumo.aberto)}
              hint={resumo.vencido > 0 ? `${brl(resumo.vencido)} em atraso` : "Nada em atraso"}
              icon={resumo.vencido > 0 ? AlertTriangle : Receipt}
              tone={resumo.vencido > 0 ? "danger" : "default"}
            />
          </div>

          <div className="panel p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={assinatura.situacao === "ativa" ? "default" : "secondary"}>
                {SITUACAO_LABEL[assinatura.situacao] ?? assinatura.situacao}
              </Badge>
              {assinatura.teste_ate && (
                <span className="text-sm text-muted-foreground">
                  Teste grátis até {dateBR(assinatura.teste_ate)}
                </span>
              )}
              <span className="text-sm text-muted-foreground">
                Vencimento todo dia {assinatura.dia_vencimento}
              </span>
              <span className="text-sm text-muted-foreground">
                Implantação {brl(Number(assinatura.valor_implantacao))} —{" "}
                {assinatura.implantacao_paga ? "paga" : "em aberto"}
              </span>
            </div>
            {planoAtual && (
              <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {planoAtual.itens.map((i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                    {i}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {PLANOS.map((p) => {
              const atual = p.id === assinatura.plano;
              return (
                <div
                  key={p.id}
                  className={atual ? "panel border-2 border-accent p-5" : "panel p-5"}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display text-lg font-bold">{p.nome}</h3>
                    {atual && <Badge>Seu plano</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{p.resumo}</p>
                  <p className="mt-3 font-display text-2xl font-bold">
                    {brl(p.valor)}
                    <span className="ml-1 text-xs font-medium text-muted-foreground">/mês</span>
                  </p>
                  {p.teste && (
                    <p className="mt-1 text-xs text-muted-foreground">15 dias de teste grátis</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="panel overflow-x-auto">
            <div className="border-b border-border px-4 py-3">
              <p className="font-display text-sm font-semibold">Pagamentos da assinatura</p>
              <p className="text-xs text-muted-foreground">
                A mensalidade do plano e as filiais extras são lançadas automaticamente a cada mês,
                no dia de vencimento escolhido — sem lançamento manual.
              </p>
            </div>
            {faturas.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Nenhuma cobrança lançada.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cobrança</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">Pago</TableHead>
                    <TableHead className="text-right">Falta</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {faturas.map((f) => {
                    const falta = Math.max(Number(f.valor) - Number(f.valor_pago), 0);
                    const atrasada = falta > 0 && f.vencimento < new Date().toISOString().slice(0, 10);
                    return (
                      <TableRow key={f.id}>
                        <TableCell className="max-w-[18rem] truncate">{f.descricao}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {TIPO_LABEL[f.tipo] ?? f.tipo}
                        </TableCell>
                        <TableCell className="text-sm">{dateBR(f.vencimento)}</TableCell>
                        <TableCell className="text-right text-numeric">
                          {brl(Number(f.valor))}
                        </TableCell>
                        <TableCell className="text-right text-numeric">
                          {brl(Number(f.valor_pago))}
                        </TableCell>
                        <TableCell className="text-right text-numeric">{brl(falta)}</TableCell>
                        <TableCell>
                          {falta <= 0 ? (
                            <span className="inline-flex items-center gap-1 text-sm text-success">
                              <Check className="size-3.5" /> Pago {dateBR(f.pago_em)}
                            </span>
                          ) : atrasada ? (
                            <Badge variant="destructive">Em atraso</Badge>
                          ) : (
                            <Badge variant="outline">Em aberto</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {falta > 0 && podeEditar && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setPagar(f);
                                setValorPago(String(falta.toFixed(2)));
                                setForma("pix");
                              }}
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
            )}
          </div>
        </div>
      )}

      <div className="panel mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-display text-sm font-semibold">Interessados nos planos</p>
            <p className="text-xs text-muted-foreground">
              Contatos enviados pela página pública de contato.
            </p>
          </div>
        </div>
        {(contatos ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhum contato recebido ainda.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {(contatos ?? []).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{c.nome}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[c.email, c.whatsapp].filter(Boolean).join(" · ") || "—"}
                    {c.plano_interesse ? ` · plano ${c.plano_interesse}` : ""} ·{" "}
                    {dateBR(c.created_at)}
                  </p>
                  {c.mensagem && <p className="mt-1 text-xs">{c.mensagem}</p>}
                </div>
                <div className="flex gap-2">
                  {c.whatsapp && (
                    <Button asChild size="sm" variant="outline">
                      <a
                        href={`https://wa.me/${c.whatsapp.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        WhatsApp
                      </a>
                    </Button>
                  )}
                  {c.email && (
                    <Button asChild size="sm" variant="outline">
                      <a href={`mailto:${c.email}?subject=Planos ERP Ze Tech`}>E-mail</a>
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* alterar plano */}
      <Dialog open={editar} onOpenChange={setEditar}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar plano</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Plano</Label>
              <Select value={form.plano} onValueChange={(v) => setForm({ ...form, plano: v })}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLANOS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome} — {brl(p.valor)}/mês
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Filiais extras</Label>
                <Input
                  className="mt-1"
                  inputMode="numeric"
                  value={form.filiais_extras}
                  onChange={(e) => setForm({ ...form, filiais_extras: e.target.value })}
                />
              </div>
              <div>
                <Label>Dia de vencimento</Label>
                <Input
                  className="mt-1"
                  inputMode="numeric"
                  value={form.dia_vencimento}
                  onChange={(e) => setForm({ ...form, dia_vencimento: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditar(false)}>
              Cancelar
            </Button>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* implantação de filial extra */}
      <Dialog open={implantacao} onOpenChange={setImplantacao}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Implantar filial extra</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Lança a implantação de {brl(Number(assinatura?.valor_implantacao ?? 1500))} (cadastro
            inicial, importação de produtos e treinamento) e soma{" "}
            {brl(Number(assinatura?.valor_filial_extra ?? 390))} por mês na assinatura.
          </p>
          <div>
            <Label>Nome da nova filial</Label>
            <Input
              className="mt-1"
              value={filialNome}
              onChange={(e) => setFilialNome(e.target.value)}
              placeholder="Loja Norte"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImplantacao(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => cobrarImplantacao.mutate()}
              disabled={cobrarImplantacao.isPending}
            >
              Lançar implantação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* pagamento */}
      <Dialog open={!!pagar} onOpenChange={(o) => !o && setPagar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar pagamento</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{pagar?.descricao}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Valor pago</Label>
              <Input
                className="mt-1"
                inputMode="decimal"
                value={valorPago}
                onChange={(e) => setValorPago(e.target.value)}
              />
            </div>
            <div>
              <Label>Forma de pagamento</Label>
              <Select value={forma} onValueChange={setForma}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["pix", "boleto", "cartao", "transferencia", "dinheiro"].map((f) => (
                    <SelectItem key={f} value={f} className="capitalize">
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPagar(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => registrarPagamento.mutate()}
              disabled={registrarPagamento.isPending}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
