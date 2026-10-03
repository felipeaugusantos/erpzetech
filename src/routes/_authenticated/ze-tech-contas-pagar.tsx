import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Pencil, Plus, Search, Wallet } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR } from "@/lib/format";
import { diasEntre, useSaasDados, useSaasOperador, type LojaSaas } from "@/lib/saas";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/ze-tech-contas-pagar")({
  head: () => ({
    meta: [
      { title: "Contas a pagar — Painel Ze Tech" },
      {
        name: "description",
        content:
          "Contas a pagar da Ze Tech por loja do cliente, com vencimento, valor, situação e pagamentos.",
      },
      { property: "og:title", content: "Contas a pagar — Painel Ze Tech" },
      {
        property: "og:description",
        content: "Acompanhe o que a Ze Tech tem a pagar por loja, com vencimento, valor e status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContasPagarZeTech,
});

type Conta = {
  id: string;
  cliente_id: string | null;
  loja_id: string | null;
  descricao: string;
  categoria: string | null;
  fornecedor: string | null;
  vencimento: string;
  valor: number;
  valor_pago: number;
  pago_em: string | null;
  forma_pagamento: string | null;
  situacao: string;
  observacoes: string | null;
};

type Form = {
  id?: string;
  cliente_id: string;
  loja_id: string;
  descricao: string;
  categoria: string;
  fornecedor: string;
  vencimento: string;
  valor: string;
  forma_pagamento: string;
  observacoes: string;
};

const hojeISO = () => new Date().toISOString().slice(0, 10);

const vazio = (): Form => ({
  cliente_id: "",
  loja_id: "",
  descricao: "",
  categoria: "infraestrutura",
  fornecedor: "",
  vencimento: hojeISO(),
  valor: "0",
  forma_pagamento: "pix",
  observacoes: "",
});

const CATEGORIAS = [
  { value: "infraestrutura", label: "Infraestrutura e nuvem" },
  { value: "implantacao", label: "Implantação em loja" },
  { value: "suporte", label: "Suporte e serviços" },
  { value: "comissao", label: "Comissão de parceiro" },
  { value: "imposto", label: "Impostos e taxas" },
  { value: "outros", label: "Outros" },
];

function ContasPagarZeTech() {
  const qc = useQueryClient();
  const { data: operador, isLoading: carregandoAcesso } = useSaasOperador();
  const { data: base } = useSaasDados(operador === true);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("abertas");
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Form>(vazio);
  const [pagar, setPagar] = useState<Conta | null>(null);
  const [valorPago, setValorPago] = useState("0");

  const { data: lojas = [] } = useQuery({
    queryKey: ["saas-lojas"],
    enabled: operador === true,
    queryFn: async () => {
      const { data, error } = await supabase.from("saas_lojas").select("*").order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as LojaSaas[];
    },
  });

  const { data: contas = [], isLoading } = useQuery({
    queryKey: ["saas-contas-pagar"],
    enabled: operador === true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saas_contas_pagar")
        .select("*")
        .order("vencimento");
      if (error) throw error;
      return (data ?? []) as unknown as Conta[];
    },
  });

  const clientes = base?.clientes ?? [];
  const nomeCliente = (id: string | null) => clientes.find((c) => c.id === id)?.nome ?? "—";
  const nomeLoja = (id: string | null) => lojas.find((l) => l.id === id)?.nome ?? "—";

  const comStatus = useMemo(
    () =>
      contas.map((c) => {
        const saldo = Number(c.valor) - Number(c.valor_pago);
        const status = saldo <= 0 ? "paga" : diasEntre(c.vencimento) < 0 ? "atrasada" : "aberta";
        return { ...c, saldo, status };
      }),
    [contas],
  );

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return comStatus.filter((c) => {
      const okFiltro =
        filtro === "todas"
          ? true
          : filtro === "abertas"
            ? c.status !== "paga"
            : c.status === filtro;
      if (!okFiltro) return false;
      if (!t) return true;
      return [c.descricao, c.fornecedor, nomeCliente(c.cliente_id), nomeLoja(c.loja_id)]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(t));
    });
  }, [comStatus, busca, filtro, clientes, lojas]);

  const totais = useMemo(() => {
    const abertas = comStatus.filter((c) => c.status !== "paga");
    const mes = hojeISO().slice(0, 7);
    return {
      aberto: abertas.reduce((s, c) => s + c.saldo, 0),
      atrasado: comStatus.filter((c) => c.status === "atrasada").reduce((s, c) => s + c.saldo, 0),
      doMes: abertas
        .filter((c) => c.vencimento.slice(0, 7) === mes)
        .reduce((s, c) => s + c.saldo, 0),
      pagoMes: comStatus
        .filter((c) => c.pago_em?.slice(0, 7) === mes)
        .reduce((s, c) => s + Number(c.valor_pago), 0),
    };
  }, [comStatus]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.descricao.trim()) throw new Error("Informe a descrição da conta");
      const payload = {
        cliente_id: form.cliente_id || null,
        loja_id: form.loja_id || null,
        descricao: form.descricao.trim(),
        categoria: form.categoria,
        fornecedor: form.fornecedor || null,
        vencimento: form.vencimento,
        valor: Number(form.valor.replace(",", ".") || 0),
        forma_pagamento: form.forma_pagamento || null,
        observacoes: form.observacoes || null,
      };
      if (form.id) {
        const { error } = await supabase
          .from("saas_contas_pagar")
          .update(payload)
          .eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("saas_contas_pagar").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(form.id ? "Conta atualizada." : "Conta lançada.");
      setAberto(false);
      setForm(vazio());
      void qc.invalidateQueries({ queryKey: ["saas-contas-pagar"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const registrarPagamento = useMutation({
    mutationFn: async () => {
      if (!pagar) return;
      const valor = Number(valorPago.replace(",", ".") || 0);
      if (valor <= 0) throw new Error("Informe o valor pago");
      const pago = Number(pagar.valor_pago) + valor;
      const { error } = await supabase
        .from("saas_contas_pagar")
        .update({
          valor_pago: pago,
          pago_em: pago >= Number(pagar.valor) ? hojeISO() : pagar.pago_em,
          situacao: pago >= Number(pagar.valor) ? "paga" : "parcial",
        })
        .eq("id", pagar.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pagamento registrado.");
      setPagar(null);
      void qc.invalidateQueries({ queryKey: ["saas-contas-pagar"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (carregandoAcesso) {
    return <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>;
  }
  if (operador !== true) {
    return (
      <EmptyState
        title="Área exclusiva da equipe Ze Tech."
        description="Entre com um acesso da equipe para ver as contas a pagar."
      />
    );
  }

  const lojasDoCliente = lojas.filter((l) => !form.cliente_id || l.cliente_id === form.cliente_id);

  return (
    <div>
      <PageHeader
        title="Contas a pagar da Ze Tech"
        description="O que a Ze Tech tem a pagar, com vencimento, valor, situação e a loja do cliente."
        actions={
          <Button
            onClick={() => {
              setForm(vazio());
              setAberto(true);
            }}
          >
            <Plus className="size-4" /> Nova conta
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total a pagar" value={brl(totais.aberto)} icon={Wallet} />
        <StatCard label="Vencidas" value={brl(totais.atrasado)} tone="danger" />
        <StatCard label="Vence neste mês" value={brl(totais.doMes)} tone="warning" />
        <StatCard label="Pago no mês" value={brl(totais.pagoMes)} tone="success" />
      </div>

      <div className="panel mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por descrição, fornecedor, cliente ou loja"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <Select value={filtro} onValueChange={setFiltro}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="abertas">Em aberto</SelectItem>
            <SelectItem value="atrasada">Vencidas</SelectItem>
            <SelectItem value="paga">Pagas</SelectItem>
            <SelectItem value="todas">Todas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhuma conta a pagar."
          description="Lance as despesas da Ze Tech e ligue cada uma à loja do cliente quando fizer sentido."
          action={
            <Button
              onClick={() => {
                setForm(vazio());
                setAberto(true);
              }}
            >
              <Plus className="size-4" /> Nova conta
            </Button>
          }
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vencimento</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Loja</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Pago</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((c) => (
                <TableRow key={c.id}>
                  <TableCell
                    className={
                      c.status === "atrasada"
                        ? "font-semibold text-destructive"
                        : "text-muted-foreground"
                    }
                  >
                    {dateBR(c.vencimento)}
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{c.descricao}</p>
                    <p className="text-xs text-muted-foreground">
                      {CATEGORIAS.find((k) => k.value === c.categoria)?.label ?? c.categoria ?? "—"}
                    </p>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {nomeCliente(c.cliente_id)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{nomeLoja(c.loja_id)}</TableCell>
                  <TableCell className="text-muted-foreground">{c.fornecedor ?? "—"}</TableCell>
                  <TableCell className="text-right text-numeric">{brl(Number(c.valor))}</TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(c.valor_pago))}
                  </TableCell>
                  <TableCell className="text-right text-numeric font-semibold">
                    {brl(c.saldo)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={
                        c.status === "paga"
                          ? "bg-success/15 text-success"
                          : c.status === "atrasada"
                            ? "bg-destructive/15 text-destructive"
                            : "bg-warning/15 text-warning-foreground"
                      }
                    >
                      {c.status === "paga"
                        ? "Paga"
                        : c.status === "atrasada"
                          ? "Vencida"
                          : "A vencer"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {c.saldo > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setPagar(c);
                            setValorPago(c.saldo.toFixed(2));
                          }}
                        >
                          <CheckCircle2 className="size-4" /> Pagar
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setForm({
                            id: c.id,
                            cliente_id: c.cliente_id ?? "",
                            loja_id: c.loja_id ?? "",
                            descricao: c.descricao,
                            categoria: c.categoria ?? "outros",
                            fornecedor: c.fornecedor ?? "",
                            vencimento: c.vencimento,
                            valor: String(c.valor),
                            forma_pagamento: c.forma_pagamento ?? "pix",
                            observacoes: c.observacoes ?? "",
                          });
                          setAberto(true);
                        }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar conta" : "Nova conta a pagar"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Descrição</Label>
              <Input
                value={form.descricao}
                placeholder="Servidores e banco de dados — mensal"
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              />
            </div>
            <div>
              <Label>Cliente (opcional)</Label>
              <Select
                value={form.cliente_id}
                onValueChange={(v) => setForm({ ...form, cliente_id: v, loja_id: "" })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Despesa geral" />
                </SelectTrigger>
                <SelectContent>
                  {clientes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Loja (opcional)</Label>
              <Select value={form.loja_id} onValueChange={(v) => setForm({ ...form, loja_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Sem loja" />
                </SelectTrigger>
                <SelectContent>
                  {lojasDoCliente.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Categoria</Label>
              <Select
                value={form.categoria}
                onValueChange={(v) => setForm({ ...form, categoria: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIAS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Fornecedor</Label>
              <Input
                value={form.fornecedor}
                onChange={(e) => setForm({ ...form, fornecedor: e.target.value })}
              />
            </div>
            <div>
              <Label>Vencimento</Label>
              <Input
                type="date"
                value={form.vencimento}
                onChange={(e) => setForm({ ...form, vencimento: e.target.value })}
              />
            </div>
            <div>
              <Label>Valor</Label>
              <Input
                value={form.valor}
                onChange={(e) => setForm({ ...form, valor: e.target.value })}
              />
            </div>
            <div>
              <Label>Forma de pagamento</Label>
              <Select
                value={form.forma_pagamento}
                onValueChange={(v) => setForm({ ...form, forma_pagamento: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="boleto">Boleto</SelectItem>
                  <SelectItem value="transferencia">Transferência</SelectItem>
                  <SelectItem value="cartao">Cartão</SelectItem>
                  <SelectItem value="dinheiro">Dinheiro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Observações</Label>
              <Textarea
                value={form.observacoes}
                onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              />
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

      <Dialog open={!!pagar} onOpenChange={(o) => !o && setPagar(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Registrar pagamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">{pagar?.descricao}</p>
            <div>
              <Label>Valor pago</Label>
              <Input value={valorPago} onChange={(e) => setValorPago(e.target.value)} />
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
    </div>
  );
}
