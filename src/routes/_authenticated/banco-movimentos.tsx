import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Check, Landmark, Plus, TrendingDown, TrendingUp } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/banco-movimentos")({
  head: () => ({
    meta: [
      { title: "Movimentação bancária — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Extrato de cada conta: entradas, saídas, transferências, tarifas, saldo corrido e conciliação com o banco.",
      },
      { property: "og:title", content: "Movimentação bancária — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Acompanhe o dinheiro em banco, confira o extrato e concilie cada lançamento.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BancoMovimentos,
});

const TIPO_LABEL: Record<string, string> = {
  entrada: "Entrada",
  saida: "Saída",
  tarifa: "Tarifa",
  rendimento: "Rendimento",
  deposito_caixa: "Depósito do caixa",
  transferencia_saida: "Transferência enviada",
  transferencia_entrada: "Transferência recebida",
};

const ORIGEM_LABEL: Record<string, string> = {
  manual: "Lançamento manual",
  contas_receber: "Recebimento de título",
  contas_pagar: "Pagamento a fornecedor",
  caixa: "Sangria do caixa",
  transferencia: "Entre contas próprias",
};

const SAIDAS = ["saida", "tarifa", "transferencia_saida", "pagamento"];

type Movimento = {
  id: string;
  conta_id: string;
  conta_destino_id: string | null;
  data: string;
  tipo: string;
  categoria: string | null;
  valor: number;
  descricao: string;
  documento: string | null;
  forma: string | null;
  origem: string;
  conciliado: boolean;
};

function primeiroDiaDoMes() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function BancoMovimentos() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const podeLancar =
    session?.roles.some((r) => ["administrador", "gestor", "financeiro", "caixa"].includes(r)) ??
    false;
  const podeConciliar =
    session?.roles.some((r) => ["administrador", "gestor", "financeiro"].includes(r)) ?? false;

  const [de, setDe] = useState(primeiroDiaDoMes);
  const [ate, setAte] = useState(() => new Date().toISOString().slice(0, 10));
  const [contaFiltro, setContaFiltro] = useState("todas");

  const { data, isLoading } = useQuery({
    queryKey: ["banco-extrato", de, ate],
    queryFn: async () => {
      const [contasRes, movRes, anterioresRes] = await Promise.all([
        supabase
          .from("contas_bancarias")
          .select("id, apelido, banco_nome, saldo_inicial, ativa")
          .order("apelido"),
        supabase
          .from("banco_movimentos")
          .select("*")
          .gte("data", de)
          .lte("data", ate)
          .order("data")
          .order("created_at"),
        supabase.from("banco_movimentos").select("conta_id, tipo, valor").lt("data", de),
      ]);
      if (contasRes.error) throw contasRes.error;
      if (movRes.error) throw movRes.error;
      if (anterioresRes.error) throw anterioresRes.error;
      return {
        contas: contasRes.data ?? [],
        movimentos: (movRes.data ?? []) as unknown as Movimento[],
        anteriores: anterioresRes.data ?? [],
      };
    },
  });

  const contas = data?.contas ?? [];
  const movimentos = useMemo(
    () =>
      (data?.movimentos ?? []).filter((m) => contaFiltro === "todas" || m.conta_id === contaFiltro),
    [data, contaFiltro],
  );

  /** Saldo antes do período (saldo inicial + lançamentos anteriores). */
  const saldoAnterior = useMemo(() => {
    const alvo = contas.filter((c) => contaFiltro === "todas" || c.id === contaFiltro);
    let total = alvo.reduce((s, c) => s + Number(c.saldo_inicial), 0);
    for (const m of data?.anteriores ?? []) {
      if (contaFiltro !== "todas" && m.conta_id !== contaFiltro) continue;
      total += SAIDAS.includes(m.tipo) ? -Number(m.valor) : Number(m.valor);
    }
    return total;
  }, [contas, data, contaFiltro]);

  const linhas = useMemo(() => {
    let saldo = saldoAnterior;
    return movimentos.map((m) => {
      const saida = SAIDAS.includes(m.tipo);
      saldo += saida ? -Number(m.valor) : Number(m.valor);
      return { mov: m, saida, saldo };
    });
  }, [movimentos, saldoAnterior]);

  const resumo = useMemo(() => {
    const entradas = linhas.filter((l) => !l.saida).reduce((s, l) => s + Number(l.mov.valor), 0);
    const saidas = linhas.filter((l) => l.saida).reduce((s, l) => s + Number(l.mov.valor), 0);
    return {
      entradas,
      saidas,
      saldo: saldoAnterior + entradas - saidas,
      pendentes: linhas.filter((l) => !l.mov.conciliado).length,
    };
  }, [linhas, saldoAnterior]);

  const nomeConta = (id: string | null) => contas.find((c) => c.id === id)?.apelido ?? "—";

  /* ---------- lançamento manual ---------- */
  const [lanc, setLanc] = useState(false);
  const [lf, setLf] = useState({
    conta_id: "",
    tipo: "saida",
    valor: "",
    descricao: "",
    data: new Date().toISOString().slice(0, 10),
    documento: "",
  });

  const lancar = useMutation({
    mutationFn: async () => {
      const valor = Number(lf.valor.replace(",", "."));
      if (!lf.conta_id) throw new Error("Escolha a conta.");
      if (!Number.isFinite(valor) || valor <= 0) throw new Error("Informe o valor.");
      if (!lf.descricao.trim()) throw new Error("Descreva o lançamento.");
      const { error } = await supabase.rpc("banco_lancar", {
        p_conta_id: lf.conta_id,
        p_tipo: lf.tipo,
        p_valor: valor,
        p_descricao: lf.descricao.trim(),
        p_data: lf.data,
        ...(lf.documento.trim() ? { p_documento: lf.documento.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lançamento registrado.");
      setLanc(false);
      setLf({ ...lf, valor: "", descricao: "", documento: "" });
      void qc.invalidateQueries({ queryKey: ["banco-extrato"] });
      void qc.invalidateQueries({ queryKey: ["contas-bancarias"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* ---------- transferência entre contas ---------- */
  const [transf, setTransf] = useState(false);
  const [tf, setTf] = useState({
    origem: "",
    destino: "",
    valor: "",
    data: new Date().toISOString().slice(0, 10),
    observacao: "",
  });

  const transferir = useMutation({
    mutationFn: async () => {
      const valor = Number(tf.valor.replace(",", "."));
      if (!tf.origem || !tf.destino) throw new Error("Escolha as contas de origem e destino.");
      if (!Number.isFinite(valor) || valor <= 0) throw new Error("Informe o valor.");
      const { error } = await supabase.rpc("banco_transferir", {
        p_origem_id: tf.origem,
        p_destino_id: tf.destino,
        p_valor: valor,
        p_data: tf.data,
        ...(tf.observacao.trim() ? { p_observacao: tf.observacao.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transferência registrada nas duas contas.");
      setTransf(false);
      setTf({ ...tf, valor: "", observacao: "" });
      void qc.invalidateQueries({ queryKey: ["banco-extrato"] });
      void qc.invalidateQueries({ queryKey: ["contas-bancarias"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const conciliar = useMutation({
    mutationFn: async ({ id, valor }: { id: string; valor: boolean }) => {
      const { error } = await supabase.rpc("banco_conciliar", {
        p_mov_id: id,
        p_conciliado: valor,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["banco-extrato"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="Movimentação bancária"
        description="Extrato das contas com entradas, saídas, transferências, tarifas, saldo corrido e conferência com o banco."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/contas-bancarias">Contas bancárias</Link>
            </Button>
            {podeLancar && (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setTf({ ...tf, origem: contas[0]?.id ?? "", destino: contas[1]?.id ?? "" });
                    setTransf(true);
                  }}
                >
                  <ArrowLeftRight className="size-4" /> Transferir
                </Button>
                <Button
                  onClick={() => {
                    setLf({
                      ...lf,
                      conta_id: contaFiltro !== "todas" ? contaFiltro : (contas[0]?.id ?? ""),
                    });
                    setLanc(true);
                  }}
                >
                  <Plus className="size-4" /> Novo lançamento
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="panel mb-5 grid gap-3 p-4 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="f-conta">Conta</Label>
          <Select value={contaFiltro} onValueChange={setContaFiltro}>
            <SelectTrigger id="f-conta">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as contas</SelectItem>
              {contas.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.apelido}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-de">De</Label>
          <Input id="f-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-ate">Até</Label>
          <Input id="f-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Saldo anterior"
          value={brl(saldoAnterior)}
          hint={`antes de ${dateBR(de)}`}
          icon={Landmark}
        />
        <StatCard
          label="Entradas"
          value={brl(resumo.entradas)}
          hint="No período"
          icon={TrendingUp}
        />
        <StatCard label="Saídas" value={brl(resumo.saidas)} hint="No período" icon={TrendingDown} />
        <StatCard
          label="Saldo final"
          value={brl(resumo.saldo)}
          hint={`${resumo.pendentes} lançamento(s) a conferir`}
          icon={Check}
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : linhas.length === 0 ? (
        <EmptyState
          title="Nenhum lançamento no período."
          description="Os recebimentos em PIX, boleto ou transferência, os pagamentos a fornecedores e as sangrias do caixa entram aqui automaticamente."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Data</TableHead>
                <TableHead className="w-40">Conta</TableHead>
                <TableHead className="min-w-56">Descrição</TableHead>
                <TableHead className="w-40">Tipo</TableHead>
                <TableHead className="w-28 text-right">Entrada</TableHead>
                <TableHead className="w-28 text-right">Saída</TableHead>
                <TableHead className="w-32 text-right">Saldo</TableHead>
                <TableHead className="w-28 text-center">Conferido</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map(({ mov, saida, saldo }) => (
                <TableRow key={mov.id} className="align-middle">
                  <TableCell>{dateBR(mov.data)}</TableCell>
                  <TableCell>
                    {nomeConta(mov.conta_id)}
                    {mov.conta_destino_id && (
                      <span className="block text-xs text-muted-foreground">
                        {saida ? "para" : "de"} {nomeConta(mov.conta_destino_id)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <p>{mov.descricao}</p>
                    <p className="text-xs text-muted-foreground">
                      {ORIGEM_LABEL[mov.origem] ?? mov.origem}
                      {mov.forma ? ` · ${mov.forma}` : ""}
                      {mov.documento ? ` · doc ${mov.documento}` : ""}
                    </p>
                  </TableCell>
                  <TableCell>{TIPO_LABEL[mov.tipo] ?? mov.tipo}</TableCell>
                  <TableCell className="text-right">{saida ? "—" : brl(mov.valor)}</TableCell>
                  <TableCell className="text-right">{saida ? brl(mov.valor) : "—"}</TableCell>
                  <TableCell className={`text-right ${saldo < 0 ? "text-destructive" : ""}`}>
                    {brl(saldo)}
                  </TableCell>
                  <TableCell className="text-center">
                    {mov.conciliado ? (
                      podeConciliar ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => conciliar.mutate({ id: mov.id, valor: false })}
                        >
                          <Badge>Conferido</Badge>
                        </Button>
                      ) : (
                        <Badge>Conferido</Badge>
                      )
                    ) : podeConciliar ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => conciliar.mutate({ id: mov.id, valor: true })}
                      >
                        Conferir
                      </Button>
                    ) : (
                      <Badge variant="secondary">A conferir</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={lanc} onOpenChange={setLanc}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo lançamento bancário</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="l-conta">Conta</Label>
              <Select value={lf.conta_id} onValueChange={(v) => setLf({ ...lf, conta_id: v })}>
                <SelectTrigger id="l-conta">
                  <SelectValue placeholder="Escolha a conta" />
                </SelectTrigger>
                <SelectContent>
                  {contas.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.apelido}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-tipo">Tipo</Label>
              <Select value={lf.tipo} onValueChange={(v) => setLf({ ...lf, tipo: v })}>
                <SelectTrigger id="l-tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrada">Entrada (depósito, empréstimo)</SelectItem>
                  <SelectItem value="saida">Saída (despesa, retirada)</SelectItem>
                  <SelectItem value="tarifa">Tarifa bancária</SelectItem>
                  <SelectItem value="rendimento">Rendimento</SelectItem>
                  <SelectItem value="deposito_caixa">Depósito do caixa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-valor">Valor (R$)</Label>
              <Input
                id="l-valor"
                inputMode="decimal"
                value={lf.valor}
                onChange={(e) => setLf({ ...lf, valor: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-desc">Descrição</Label>
              <Input
                id="l-desc"
                value={lf.descricao}
                onChange={(e) => setLf({ ...lf, descricao: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="l-data">Data</Label>
                <Input
                  id="l-data"
                  type="date"
                  value={lf.data}
                  onChange={(e) => setLf({ ...lf, data: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="l-doc">Documento</Label>
                <Input
                  id="l-doc"
                  value={lf.documento}
                  onChange={(e) => setLf({ ...lf, documento: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => lancar.mutate()} disabled={lancar.isPending}>
              Lançar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transf} onOpenChange={setTransf}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transferência entre contas próprias</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="t-org">Conta de origem</Label>
              <Select value={tf.origem} onValueChange={(v) => setTf({ ...tf, origem: v })}>
                <SelectTrigger id="t-org">
                  <SelectValue placeholder="Escolha" />
                </SelectTrigger>
                <SelectContent>
                  {contas.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.apelido}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="t-dst">Conta de destino</Label>
              <Select value={tf.destino} onValueChange={(v) => setTf({ ...tf, destino: v })}>
                <SelectTrigger id="t-dst">
                  <SelectValue placeholder="Escolha" />
                </SelectTrigger>
                <SelectContent>
                  {contas.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.apelido}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="t-valor">Valor (R$)</Label>
                <Input
                  id="t-valor"
                  inputMode="decimal"
                  value={tf.valor}
                  onChange={(e) => setTf({ ...tf, valor: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="t-data">Data</Label>
                <Input
                  id="t-data"
                  type="date"
                  value={tf.data}
                  onChange={(e) => setTf({ ...tf, data: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="t-obs">Observação</Label>
              <Input
                id="t-obs"
                value={tf.observacao}
                onChange={(e) => setTf({ ...tf, observacao: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => transferir.mutate()} disabled={transferir.isPending}>
              Transferir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
