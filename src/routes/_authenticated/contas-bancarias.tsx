import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Landmark, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, dateBR } from "@/lib/format";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
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

export const Route = createFileRoute("/_authenticated/contas-bancarias")({
  head: () => ({
    meta: [
      { title: "Contas bancárias — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Cadastro das contas bancárias da loja: banco, agência, conta, tipo, filial dona e saldo inicial.",
      },
      { property: "og:title", content: "Contas bancárias — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Separe o caixa da loja do dinheiro em banco e veja o saldo de cada conta.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContasBancarias,
});

export const TIPO_CONTA: Record<string, string> = {
  corrente: "Conta corrente",
  poupanca: "Poupança",
  pagamento: "Conta de pagamento (PIX)",
  caixinha: "Cofre / reserva",
};

type Conta = {
  id: string;
  filial_id: string | null;
  apelido: string;
  banco_codigo: string | null;
  banco_nome: string | null;
  agencia: string | null;
  conta: string | null;
  conta_digito: string | null;
  tipo: string;
  chave_pix: string | null;
  saldo_inicial: number;
  saldo_inicial_data: string;
  padrao: boolean;
  ativa: boolean;
  observacoes: string | null;
};

type Form = {
  apelido: string;
  banco_codigo: string;
  banco_nome: string;
  agencia: string;
  conta: string;
  conta_digito: string;
  tipo: string;
  chave_pix: string;
  filial_id: string;
  saldo_inicial: string;
  saldo_inicial_data: string;
  padrao: boolean;
  ativa: boolean;
  observacoes: string;
};

function ContasBancarias() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const podeEditar =
    session?.roles.some((r) => ["administrador", "gestor", "financeiro"].includes(r)) ?? false;

  const { data, isLoading } = useQuery({
    queryKey: ["contas-bancarias"],
    queryFn: async () => {
      const [contasRes, movRes] = await Promise.all([
        supabase.from("contas_bancarias").select("*").order("apelido"),
        supabase.from("banco_movimentos").select("conta_id, tipo, valor"),
      ]);
      if (contasRes.error) throw contasRes.error;
      if (movRes.error) throw movRes.error;
      return {
        contas: (contasRes.data ?? []) as unknown as Conta[],
        movimentos: movRes.data ?? [],
      };
    },
  });

  const contas = data?.contas ?? [];

  /** Saldo = saldo inicial +/- lançamentos do extrato. */
  const saldos = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const c of contas) mapa.set(c.id, Number(c.saldo_inicial));
    for (const m of data?.movimentos ?? []) {
      const atual = mapa.get(m.conta_id) ?? 0;
      const saida = ["saida", "tarifa", "transferencia_saida", "pagamento"].includes(m.tipo);
      mapa.set(m.conta_id, atual + (saida ? -Number(m.valor) : Number(m.valor)));
    }
    return mapa;
  }, [contas, data]);

  const total = contas.filter((c) => c.ativa).reduce((s, c) => s + (saldos.get(c.id) ?? 0), 0);

  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<Conta | null>(null);
  const vazio: Form = {
    apelido: "",
    banco_codigo: "",
    banco_nome: "",
    agencia: "",
    conta: "",
    conta_digito: "",
    tipo: "corrente",
    chave_pix: "",
    filial_id: session?.profile?.filial_id ?? session?.filiais[0]?.id ?? "",
    saldo_inicial: "0",
    saldo_inicial_data: new Date().toISOString().slice(0, 10),
    padrao: false,
    ativa: true,
    observacoes: "",
  };
  const [form, setForm] = useState<Form>(vazio);

  function abrirNovo() {
    setEditando(null);
    setForm(vazio);
    setAberto(true);
  }

  function abrirEdicao(c: Conta) {
    setEditando(c);
    setForm({
      apelido: c.apelido,
      banco_codigo: c.banco_codigo ?? "",
      banco_nome: c.banco_nome ?? "",
      agencia: c.agencia ?? "",
      conta: c.conta ?? "",
      conta_digito: c.conta_digito ?? "",
      tipo: c.tipo,
      chave_pix: c.chave_pix ?? "",
      filial_id: c.filial_id ?? "",
      saldo_inicial: String(c.saldo_inicial),
      saldo_inicial_data: c.saldo_inicial_data,
      padrao: c.padrao,
      ativa: c.ativa,
      observacoes: c.observacoes ?? "",
    });
    setAberto(true);
  }

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.apelido.trim()) throw new Error("Dê um apelido à conta, ex.: Itaú movimento.");
      const payload = {
        apelido: form.apelido.trim(),
        banco_codigo: form.banco_codigo.trim() || null,
        banco_nome: form.banco_nome.trim() || null,
        agencia: form.agencia.trim() || null,
        conta: form.conta.trim() || null,
        conta_digito: form.conta_digito.trim() || null,
        tipo: form.tipo,
        chave_pix: form.chave_pix.trim() || null,
        filial_id: form.filial_id || null,
        saldo_inicial: Number(form.saldo_inicial.replace(",", ".")) || 0,
        saldo_inicial_data: form.saldo_inicial_data,
        padrao: form.padrao,
        ativa: form.ativa,
        observacoes: form.observacoes.trim() || null,
      };
      const res = editando
        ? await supabase.from("contas_bancarias").update(payload).eq("id", editando.id)
        : await supabase.from("contas_bancarias").insert(payload);
      if (res.error) throw res.error;

      // só uma conta pode ser o destino padrão do dinheiro
      if (form.padrao) {
        const { data: todas } = await supabase
          .from("contas_bancarias")
          .select("id")
          .eq("padrao", true);
        const manter = editando?.id;
        for (const c of todas ?? []) {
          if (c.id !== manter && !editando) continue;
          if (c.id !== manter)
            await supabase.from("contas_bancarias").update({ padrao: false }).eq("id", c.id);
        }
      }
    },
    onSuccess: () => {
      toast.success(editando ? "Conta atualizada." : "Conta cadastrada.");
      setAberto(false);
      void qc.invalidateQueries({ queryKey: ["contas-bancarias"] });
      void qc.invalidateQueries({ queryKey: ["banco-extrato"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filialNome = (id: string | null) =>
    session?.filiais.find((f) => f.id === id)?.nome ?? "Todas as lojas";

  return (
    <>
      <PageHeader
        title="Contas bancárias"
        description="Bancos da loja: destino dos recebimentos, origem dos pagamentos e o dinheiro fora do caixa."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/banco-movimentos">Movimentação bancária</Link>
            </Button>
            {podeEditar && (
              <Button onClick={abrirNovo}>
                <Plus className="size-4" /> Nova conta
              </Button>
            )}
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Saldo em bancos" value={brl(total)} hint="Contas ativas" icon={Landmark} />
        <StatCard
          label="Contas ativas"
          value={String(contas.filter((c) => c.ativa).length)}
          hint={`${contas.length} cadastrada(s)`}
          icon={Wallet}
        />
        <StatCard
          label="Conta padrão"
          value={contas.find((c) => c.padrao && c.ativa)?.apelido ?? "não definida"}
          hint="Recebe PIX, boleto e transferência"
          icon={Building2}
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : contas.length === 0 ? (
        <EmptyState
          title="Nenhuma conta bancária cadastrada."
          description="Cadastre o banco da loja para separar o caixa do dinheiro em conta."
          action={podeEditar ? <Button onClick={abrirNovo}>Nova conta</Button> : undefined}
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-48">Conta</TableHead>
                <TableHead className="w-44">Banco</TableHead>
                <TableHead className="w-36">Agência / conta</TableHead>
                <TableHead className="w-40">Tipo</TableHead>
                <TableHead className="w-40">Loja</TableHead>
                <TableHead className="w-32 text-right">Saldo</TableHead>
                <TableHead className="w-28 text-center">Situação</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {contas.map((c) => (
                <TableRow key={c.id} className="align-middle">
                  <TableCell>
                    <p className="font-medium">{c.apelido}</p>
                    {c.padrao && <Badge variant="secondary">Padrão</Badge>}
                  </TableCell>
                  <TableCell>
                    {c.banco_nome ?? "—"}
                    <span className="block text-xs text-muted-foreground">
                      {c.banco_codigo ?? ""}
                    </span>
                  </TableCell>
                  <TableCell>
                    {c.agencia ?? "—"} / {c.conta ?? "—"}
                    {c.conta_digito ? `-${c.conta_digito}` : ""}
                  </TableCell>
                  <TableCell>{TIPO_CONTA[c.tipo] ?? c.tipo}</TableCell>
                  <TableCell>{filialNome(c.filial_id)}</TableCell>
                  <TableCell className="text-right">
                    {brl(saldos.get(c.id) ?? 0)}
                    <span className="block text-xs text-muted-foreground">
                      inicial {brl(c.saldo_inicial)} em {dateBR(c.saldo_inicial_data)}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={c.ativa ? "default" : "secondary"}>
                      {c.ativa ? "Ativa" : "Inativa"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {podeEditar && (
                      <Button variant="ghost" size="sm" onClick={() => abrirEdicao(c)}>
                        Editar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editando ? `Editar ${editando.apelido}` : "Nova conta bancária"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="b-apelido">Apelido da conta</Label>
              <Input
                id="b-apelido"
                placeholder="Itaú movimento"
                value={form.apelido}
                onChange={(e) => setForm({ ...form, apelido: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="b-banco">Banco</Label>
              <Input
                id="b-banco"
                placeholder="Itaú Unibanco"
                value={form.banco_nome}
                onChange={(e) => setForm({ ...form, banco_nome: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="b-codigo">Código do banco</Label>
              <Input
                id="b-codigo"
                placeholder="341"
                value={form.banco_codigo}
                onChange={(e) => setForm({ ...form, banco_codigo: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="b-ag">Agência</Label>
              <Input
                id="b-ag"
                value={form.agencia}
                onChange={(e) => setForm({ ...form, agencia: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-[1fr_5rem] gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="b-conta">Conta</Label>
                <Input
                  id="b-conta"
                  value={form.conta}
                  onChange={(e) => setForm({ ...form, conta: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="b-dig">Dígito</Label>
                <Input
                  id="b-dig"
                  value={form.conta_digito}
                  onChange={(e) => setForm({ ...form, conta_digito: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="b-tipo">Tipo de conta</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                <SelectTrigger id="b-tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TIPO_CONTA).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="b-pix">Chave PIX</Label>
              <Input
                id="b-pix"
                value={form.chave_pix}
                onChange={(e) => setForm({ ...form, chave_pix: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="b-filial">Loja dona da conta</Label>
              <Select
                value={form.filial_id}
                onValueChange={(v) => setForm({ ...form, filial_id: v })}
              >
                <SelectTrigger id="b-filial">
                  <SelectValue placeholder="Escolha a loja" />
                </SelectTrigger>
                <SelectContent>
                  {(session?.filiais ?? []).map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="b-saldo">Saldo inicial (R$)</Label>
              <Input
                id="b-saldo"
                inputMode="decimal"
                value={form.saldo_inicial}
                onChange={(e) => setForm({ ...form, saldo_inicial: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="b-data">Data do saldo inicial</Label>
              <Input
                id="b-data"
                type="date"
                value={form.saldo_inicial_data}
                onChange={(e) => setForm({ ...form, saldo_inicial_data: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="b-padrao"
                checked={form.padrao}
                onCheckedChange={(v) => setForm({ ...form, padrao: v })}
              />
              <Label htmlFor="b-padrao">Conta padrão (recebe PIX, boleto e transferência)</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="b-ativa"
                checked={form.ativa}
                onCheckedChange={(v) => setForm({ ...form, ativa: v })}
              />
              <Label htmlFor="b-ativa">Conta ativa</Label>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="b-obs">Observações</Label>
              <Textarea
                id="b-obs"
                value={form.observacoes}
                onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              Salvar conta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
