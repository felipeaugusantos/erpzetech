import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, CircleDollarSign, Plus, Users, Wallet } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR } from "@/lib/format";
import {
  SITUACAO_SAAS,
  TIPO_FATURA_SAAS,
  diasEntre,
  useSaasDados,
  useSaasOperador,
  type ClienteSaas,
  type ResumoCliente,
} from "@/lib/saas";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/ze-tech")({
  head: () => ({
    meta: [
      { title: "Painel Ze Tech — clientes e planos" },
      {
        name: "description",
        content:
          "Clientes assinantes do ERP Ze Tech: plano contratado, prazo restante, próximo vencimento e status de pagamento.",
      },
      { property: "og:title", content: "Painel Ze Tech — clientes e planos" },
      {
        property: "og:description",
        content: "Acompanhe quem assinou, qual plano, quanto paga e quem está em atraso.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PainelZeTech,
});

/** Dias de antecedência para avisar que a mensalidade vence. */
const AVISO_DIAS = 7;

function statusBadge(r: ResumoCliente) {
  if (r.status === "atrasado") return <Badge variant="destructive">Em atraso</Badge>;
  if (r.status === "aberto") return <Badge variant="secondary">Em aberto</Badge>;
  return <Badge>Pago</Badge>;
}

function PainelZeTech() {
  const qc = useQueryClient();
  const { data: operador, isLoading: carregandoAcesso } = useSaasOperador();
  const { data, isLoading } = useSaasDados(operador === true);
  const [busca, setBusca] = useState("");
  const [edicao, setEdicao] = useState<ClienteSaas | null>(null);
  const [novo, setNovo] = useState(false);
  const [pagar, setPagar] = useState<{ id: string; cliente: string; saldo: number } | null>(null);
  const [valorPago, setValorPago] = useState("");
  const [forma, setForma] = useState("pix");

  const resumos = data?.resumos ?? [];
  const planos = data?.planos ?? [];

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return resumos;
    return resumos.filter((r) =>
      [r.cliente.nome, r.cliente.documento, r.cliente.cidade, r.plano?.nome]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(t)),
    );
  }, [resumos, busca]);

  const kpis = useMemo(() => {
    const ativos = resumos.filter((r) => r.cliente.situacao === "ativo");
    const teste = resumos.filter((r) => r.cliente.situacao === "teste");
    return {
      total: resumos.length,
      ativos: ativos.length,
      teste: teste.length,
      recorrente: ativos.reduce((s, r) => s + r.mensal, 0),
      aberto: resumos.reduce((s, r) => s + r.aberto, 0),
      atrasado: resumos.reduce((s, r) => s + r.atrasado, 0),
    };
  }, [resumos]);

  /** Vencimentos próximos, vencidos e testes acabando. */
  const alertas = useMemo(() => {
    const lista: { cliente: string; texto: string; tom: "alerta" | "atraso"; valor: number }[] = [];
    for (const r of resumos) {
      if (r.proximoVencimento) {
        const d = diasEntre(r.proximoVencimento);
        if (d < 0)
          lista.push({
            cliente: r.cliente.nome,
            texto: `Mensalidade vencida há ${Math.abs(d)} dia(s) (${dateBR(r.proximoVencimento)})`,
            tom: "atraso",
            valor: r.proximoValor,
          });
        else if (d <= AVISO_DIAS)
          lista.push({
            cliente: r.cliente.nome,
            texto:
              d === 0
                ? `Mensalidade vence hoje (${dateBR(r.proximoVencimento)})`
                : `Mensalidade vence em ${d} dia(s) — ${dateBR(r.proximoVencimento)}`,
            tom: "alerta",
            valor: r.proximoValor,
          });
      }
      if (r.diasTeste !== null && r.cliente.situacao === "teste" && r.diasTeste <= AVISO_DIAS)
        lista.push({
          cliente: r.cliente.nome,
          texto:
            r.diasTeste < 0
              ? `Teste grátis encerrado em ${dateBR(r.cliente.teste_ate)}`
              : `Teste grátis termina em ${r.diasTeste} dia(s) — ${dateBR(r.cliente.teste_ate)}`,
          tom: r.diasTeste < 0 ? "atraso" : "alerta",
          valor: r.mensal,
        });
      if (r.diasRestantes <= 30)
        lista.push({
          cliente: r.cliente.nome,
          texto:
            r.diasRestantes < 0
              ? `Contrato venceu em ${dateBR(r.fim)} — renovar`
              : `Contrato termina em ${r.diasRestantes} dia(s) — ${dateBR(r.fim)}`,
          tom: r.diasRestantes < 0 ? "atraso" : "alerta",
          valor: r.mensal,
        });
    }
    return lista.sort((a, b) => (a.tom === b.tom ? 0 : a.tom === "atraso" ? -1 : 1));
  }, [resumos]);

  const gerar = useMutation({
    mutationFn: async () => {
      const { data: criadas, error } = await supabase.rpc("saas_gerar_faturas");
      if (error) throw error;
      return Number(criadas ?? 0);
    },
    onSuccess: (criadas) => {
      toast.success(
        criadas > 0
          ? `${criadas} cobrança(s) do mês lançada(s).`
          : "As cobranças do mês já estavam lançadas.",
      );
      void qc.invalidateQueries({ queryKey: ["saas-dados"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const baixar = useMutation({
    mutationFn: async () => {
      if (!pagar) return;
      const valor = Number(valorPago.replace(",", "."));
      if (!Number.isFinite(valor) || valor <= 0) throw new Error("Informe o valor recebido.");
      const { error } = await supabase.rpc("saas_baixar_fatura", {
        p_fatura_id: pagar.id,
        p_valor: valor,
        p_forma: forma,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pagamento registrado.");
      setPagar(null);
      setValorPago("");
      void qc.invalidateQueries({ queryKey: ["saas-dados"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (carregandoAcesso) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  if (!operador)
    return (
      <EmptyState
        title="Área exclusiva da Ze Tech"
        description="Este painel mostra os clientes que assinam o sistema e só está disponível para a equipe Ze Tech."
      />
    );

  return (
    <>
      <PageHeader
        title="Painel Ze Tech"
        description="Clientes que assinam o ERP Ze Tech: plano, prazo, próximo vencimento e pagamento."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/ze-tech-planos">Planos</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/ze-tech-relatorios">
                <BarChart3 className="size-4" /> Relatórios
              </Link>
            </Button>
            <Button variant="outline" onClick={() => gerar.mutate()} disabled={gerar.isPending}>
              Lançar cobranças do mês
            </Button>
            <Button onClick={() => setNovo(true)}>
              <Plus className="size-4" /> Novo cliente
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Clientes" value={String(kpis.total)} hint={`${kpis.ativos} ativo(s)`} icon={Users} />
        <StatCard
          label="Receita recorrente"
          value={brl(kpis.recorrente)}
          hint="Mensalidades + filiais extras"
          icon={CircleDollarSign}
        />
        <StatCard label="Em aberto" value={brl(kpis.aberto)} hint="Cobranças não pagas" icon={Wallet} />
        <StatCard
          label="Em atraso"
          value={brl(kpis.atrasado)}
          hint={`${kpis.teste} em teste grátis`}
          icon={AlertTriangle}
          tone={kpis.atrasado > 0 ? "danger" : "default"}
        />
      </div>

      {alertas.length > 0 && (
        <div className="panel mb-5 p-4">
          <p className="mb-3 font-display text-sm font-semibold">Avisos de vencimento</p>
          <ul className="grid gap-2">
            {alertas.map((a, i) => (
              <li
                key={`${a.cliente}-${i}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <AlertTriangle
                    className={`size-4 ${a.tom === "atraso" ? "text-destructive" : "text-muted-foreground"}`}
                  />
                  <strong>{a.cliente}</strong>
                  <span className="text-muted-foreground">{a.texto}</span>
                </span>
                <Badge variant={a.tom === "atraso" ? "destructive" : "secondary"}>{brl(a.valor)}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Tabs defaultValue="clientes">
        <TabsList>
          <TabsTrigger value="clientes">Clientes e planos</TabsTrigger>
          <TabsTrigger value="cobrancas">Cobranças</TabsTrigger>
        </TabsList>

        <TabsContent value="clientes" className="mt-4">
          <div className="panel mb-4 p-3">
            <Input
              placeholder="Buscar por cliente, documento, cidade ou plano"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : filtrados.length === 0 ? (
            <EmptyState
              title="Nenhum cliente encontrado."
              description="Cadastre os clientes que assinaram o sistema para acompanhar planos e pagamentos."
              action={<Button onClick={() => setNovo(true)}>Novo cliente</Button>}
            />
          ) : (
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-56">Cliente</TableHead>
                    <TableHead className="w-28">Plano</TableHead>
                    <TableHead className="w-28 text-right">Mensal</TableHead>
                    <TableHead className="w-32 text-center">Situação</TableHead>
                    <TableHead className="w-36">Prazo restante</TableHead>
                    <TableHead className="w-36">Próximo vencimento</TableHead>
                    <TableHead className="w-28 text-center">Pagamento</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtrados.map((r) => (
                    <TableRow key={r.cliente.id} className="align-middle">
                      <TableCell>
                        <p className="font-medium">{r.cliente.nome}</p>
                        <p className="text-xs text-muted-foreground">
                          {[r.cliente.cidade, r.cliente.uf].filter(Boolean).join(" / ") || "—"}
                          {r.cliente.responsavel ? ` · ${r.cliente.responsavel}` : ""}
                        </p>
                      </TableCell>
                      <TableCell>{r.plano?.nome ?? "—"}</TableCell>
                      <TableCell className="text-right">{brl(r.mensal)}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant={r.cliente.situacao === "ativo" ? "default" : "secondary"}>
                          {SITUACAO_SAAS[r.cliente.situacao] ?? r.cliente.situacao}
                        </Badge>
                        {r.diasTeste !== null && r.cliente.situacao === "teste" && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {r.diasTeste >= 0 ? `${r.diasTeste} dia(s) de teste` : "teste encerrado"}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className={r.diasRestantes < 0 ? "text-destructive" : ""}>
                          {r.diasRestantes < 0
                            ? "vencido"
                            : `${r.diasRestantes} dia(s)`}
                        </span>
                        <p className="text-xs text-muted-foreground">até {dateBR(r.fim)}</p>
                      </TableCell>
                      <TableCell>
                        {r.proximoVencimento ? (
                          <>
                            <span
                              className={
                                diasEntre(r.proximoVencimento) < 0
                                  ? "text-destructive"
                                  : diasEntre(r.proximoVencimento) <= AVISO_DIAS
                                    ? "font-medium"
                                    : ""
                              }
                            >
                              {dateBR(r.proximoVencimento)}
                            </span>
                            <p className="text-xs text-muted-foreground">{brl(r.proximoValor)}</p>
                          </>
                        ) : (
                          <span className="text-muted-foreground">sem cobrança aberta</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">{statusBadge(r)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setEdicao(r.cliente)}>
                          Editar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="cobrancas" className="mt-4">
          {(data?.faturas ?? []).length === 0 ? (
            <EmptyState
              title="Nenhuma cobrança lançada."
              description="Use “Lançar cobranças do mês” para gerar as mensalidades dos clientes ativos."
            />
          ) : (
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-52">Cliente</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="w-28">Tipo</TableHead>
                    <TableHead className="w-28">Vencimento</TableHead>
                    <TableHead className="w-28 text-right">Valor</TableHead>
                    <TableHead className="w-28 text-right">Pago</TableHead>
                    <TableHead className="w-28 text-center">Situação</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...(data?.faturas ?? [])]
                    .sort((a, b) => b.vencimento.localeCompare(a.vencimento))
                    .map((f) => {
                      const cliente = resumos.find((r) => r.cliente.id === f.cliente_id);
                      const saldo = Number(f.valor) - Number(f.valor_pago);
                      const atrasada = saldo > 0 && diasEntre(f.vencimento) < 0;
                      return (
                        <TableRow key={f.id} className="align-middle">
                          <TableCell className="font-medium">{cliente?.cliente.nome ?? "—"}</TableCell>
                          <TableCell>{f.descricao}</TableCell>
                          <TableCell>{TIPO_FATURA_SAAS[f.tipo] ?? f.tipo}</TableCell>
                          <TableCell className={atrasada ? "text-destructive" : ""}>
                            {dateBR(f.vencimento)}
                          </TableCell>
                          <TableCell className="text-right">{brl(f.valor)}</TableCell>
                          <TableCell className="text-right">{brl(f.valor_pago)}</TableCell>
                          <TableCell className="text-center">
                            {saldo <= 0 ? (
                              <Badge>Pago</Badge>
                            ) : atrasada ? (
                              <Badge variant="destructive">Atrasada</Badge>
                            ) : (
                              <Badge variant="secondary">Em aberto</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {saldo > 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setPagar({
                                    id: f.id,
                                    cliente: cliente?.cliente.nome ?? "Cliente",
                                    saldo,
                                  });
                                  setValorPago(String(saldo.toFixed(2)).replace(".", ","));
                                }}
                              >
                                Receber
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
        </TabsContent>
      </Tabs>

      <ClienteDialog
        aberto={novo || edicao !== null}
        cliente={edicao}
        planos={planos}
        onFechar={() => {
          setNovo(false);
          setEdicao(null);
        }}
      />

      <Dialog open={pagar !== null} onOpenChange={(a) => !a && setPagar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar pagamento — {pagar?.cliente}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pg-valor">Valor recebido (saldo {brl(pagar?.saldo)})</Label>
              <Input
                id="pg-valor"
                inputMode="decimal"
                value={valorPago}
                onChange={(e) => setValorPago(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pg-forma">Forma de pagamento</Label>
              <Select value={forma} onValueChange={setForma}>
                <SelectTrigger id="pg-forma">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="boleto">Boleto</SelectItem>
                  <SelectItem value="cartao">Cartão</SelectItem>
                  <SelectItem value="transferencia">Transferência</SelectItem>
                  <SelectItem value="dinheiro">Dinheiro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => baixar.mutate()} disabled={baixar.isPending}>
              Confirmar pagamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ---------------- cadastro do cliente assinante ---------------- */

type Form = {
  nome: string;
  documento: string;
  responsavel: string;
  email: string;
  whatsapp: string;
  cidade: string;
  uf: string;
  plano_id: string;
  inicio: string;
  prazo_meses: string;
  dia_vencimento: string;
  filiais_extras: string;
  situacao: string;
  teste_ate: string;
  implantacao_paga: boolean;
  observacoes: string;
};

function ClienteDialog({
  aberto,
  cliente,
  planos,
  onFechar,
}: {
  aberto: boolean;
  cliente: ClienteSaas | null;
  planos: { id: string; nome: string; prazo_meses: number; dias_teste: number }[];
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const vazio: Form = {
    nome: "",
    documento: "",
    responsavel: "",
    email: "",
    whatsapp: "",
    cidade: "",
    uf: "",
    plano_id: planos[0]?.id ?? "",
    inicio: new Date().toISOString().slice(0, 10),
    prazo_meses: "12",
    dia_vencimento: "10",
    filiais_extras: "0",
    situacao: "teste",
    teste_ate: "",
    implantacao_paga: false,
    observacoes: "",
  };
  const [form, setForm] = useState<Form>(vazio);
  const [carregado, setCarregado] = useState<string | null>(null);

  // preenche ao abrir em edição (sem efeito: chave muda com o cliente)
  if (aberto && cliente && carregado !== cliente.id) {
    setCarregado(cliente.id);
    setForm({
      nome: cliente.nome,
      documento: cliente.documento ?? "",
      responsavel: cliente.responsavel ?? "",
      email: cliente.email ?? "",
      whatsapp: cliente.whatsapp ?? "",
      cidade: cliente.cidade ?? "",
      uf: cliente.uf ?? "",
      plano_id: cliente.plano_id ?? planos[0]?.id ?? "",
      inicio: cliente.inicio,
      prazo_meses: String(cliente.prazo_meses),
      dia_vencimento: String(cliente.dia_vencimento),
      filiais_extras: String(cliente.filiais_extras),
      situacao: cliente.situacao,
      teste_ate: cliente.teste_ate ?? "",
      implantacao_paga: cliente.implantacao_paga,
      observacoes: cliente.observacoes ?? "",
    });
  }
  if (aberto && !cliente && carregado !== "novo") {
    setCarregado("novo");
    setForm(vazio);
  }

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim()) throw new Error("Informe o nome do cliente.");
      const payload = {
        nome: form.nome.trim(),
        documento: form.documento.trim() || null,
        responsavel: form.responsavel.trim() || null,
        email: form.email.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        cidade: form.cidade.trim() || null,
        uf: form.uf.trim() || null,
        plano_id: form.plano_id || null,
        inicio: form.inicio,
        prazo_meses: Number(form.prazo_meses) || 12,
        dia_vencimento: Math.min(Math.max(Number(form.dia_vencimento) || 10, 1), 28),
        filiais_extras: Number(form.filiais_extras) || 0,
        situacao: form.situacao,
        teste_ate: form.teste_ate || null,
        implantacao_paga: form.implantacao_paga,
        observacoes: form.observacoes.trim() || null,
      };
      const res = cliente
        ? await supabase.from("saas_clientes").update(payload).eq("id", cliente.id)
        : await supabase.from("saas_clientes").insert(payload);
      if (res.error) throw res.error;
    },
    onSuccess: () => {
      toast.success(cliente ? "Cliente atualizado." : "Cliente cadastrado.");
      setCarregado(null);
      void qc.invalidateQueries({ queryKey: ["saas-dados"] });
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog
      open={aberto}
      onOpenChange={(a) => {
        if (!a) {
          setCarregado(null);
          onFechar();
        }
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{cliente ? "Editar cliente assinante" : "Novo cliente assinante"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="c-nome">Nome da loja</Label>
            <Input id="c-nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-doc">CNPJ ou CPF</Label>
            <Input
              id="c-doc"
              value={form.documento}
              onChange={(e) => setForm({ ...form, documento: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-resp">Responsável</Label>
            <Input
              id="c-resp"
              value={form.responsavel}
              onChange={(e) => setForm({ ...form, responsavel: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-mail">E-mail</Label>
            <Input id="c-mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-zap">WhatsApp</Label>
            <Input
              id="c-zap"
              value={form.whatsapp}
              onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-cidade">Cidade</Label>
            <Input
              id="c-cidade"
              value={form.cidade}
              onChange={(e) => setForm({ ...form, cidade: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-uf">UF</Label>
            <Input id="c-uf" value={form.uf} onChange={(e) => setForm({ ...form, uf: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-plano">Plano</Label>
            <Select
              value={form.plano_id}
              onValueChange={(v) => {
                const p = planos.find((x) => x.id === v);
                setForm({
                  ...form,
                  plano_id: v,
                  prazo_meses: p ? String(p.prazo_meses) : form.prazo_meses,
                });
              }}
            >
              <SelectTrigger id="c-plano">
                <SelectValue placeholder="Escolha o plano" />
              </SelectTrigger>
              <SelectContent>
                {planos.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-situacao">Situação</Label>
            <Select value={form.situacao} onValueChange={(v) => setForm({ ...form, situacao: v })}>
              <SelectTrigger id="c-situacao">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SITUACAO_SAAS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-inicio">Início do contrato</Label>
            <Input
              id="c-inicio"
              type="date"
              value={form.inicio}
              onChange={(e) => setForm({ ...form, inicio: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-prazo">Prazo (meses)</Label>
            <Input
              id="c-prazo"
              inputMode="numeric"
              value={form.prazo_meses}
              onChange={(e) => setForm({ ...form, prazo_meses: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-dia">Dia do vencimento</Label>
            <Input
              id="c-dia"
              inputMode="numeric"
              value={form.dia_vencimento}
              onChange={(e) => setForm({ ...form, dia_vencimento: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-filiais">Filiais extras</Label>
            <Input
              id="c-filiais"
              inputMode="numeric"
              value={form.filiais_extras}
              onChange={(e) => setForm({ ...form, filiais_extras: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-teste">Teste grátis até</Label>
            <Input
              id="c-teste"
              type="date"
              value={form.teste_ate}
              onChange={(e) => setForm({ ...form, teste_ate: e.target.value })}
            />
          </div>
          {cliente && (
            <div className="sm:col-span-2">
              <AcessoAdmin cliente={cliente} />
            </div>
          )}
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="c-obs">Observações</Label>
            <Textarea
              id="c-obs"
              value={form.observacoes}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            Salvar cliente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
