import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownCircle, ArrowUpCircle, Lock, Unlock, Wallet } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, dateTimeBR } from "@/lib/format";
import { entradaCaixa, formasPagamento, labelForma, tiposCaixaMov } from "@/lib/financeiro";
import { PageHeader, EmptyState, StatCard } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

export const Route = createFileRoute("/_authenticated/caixa")({
  head: () => ({
    meta: [
      { title: "Caixa — Ze Obra" },
      {
        name: "description",
        content: "Abertura, entradas, saídas, sangria, suprimento e fechamento do caixa.",
      },
      { property: "og:title", content: "Caixa — Ze Obra" },
      { property: "og:description", content: "Controle diário do caixa da loja." },
    ],
  }),
  component: Caixa,
});

function Caixa() {
  const { data: session } = useSessionData();
  const filialId = session?.profile?.filial_id ?? session?.filiais[0]?.id ?? null;
  const queryClient = useQueryClient();

  const [abrirAberto, setAbrirAberto] = useState(false);
  const [valorAbertura, setValorAbertura] = useState("0");
  const [movAberto, setMovAberto] = useState(false);
  const [tipoMov, setTipoMov] = useState("entrada");
  const [valorMov, setValorMov] = useState("");
  const [formaMov, setFormaMov] = useState("dinheiro");
  const [descMov, setDescMov] = useState("");
  const [fecharAberto, setFecharAberto] = useState(false);
  const [valorInformado, setValorInformado] = useState("");
  const [obsFechamento, setObsFechamento] = useState("");

  const { data: caixas = [], isLoading } = useQuery({
    queryKey: ["caixas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("caixas")
        .select("*")
        .order("aberto_em", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  const caixaAtual = caixas.find((c) => c.situacao === "aberto") ?? null;

  const { data: movimentos = [] } = useQuery({
    queryKey: ["caixa-movimentos", caixaAtual?.id ?? "nenhum"],
    enabled: !!caixaAtual,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("caixa_movimentos")
        .select("*, depositos(nome), pedidos(numero, origem)")
        .eq("caixa_id", caixaAtual?.id ?? "")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const nomeDeposito = (m: (typeof movimentos)[number]) =>
    (m.depositos as unknown as { nome: string } | null)?.nome ?? null;

  const resumo = useMemo(() => {
    let entradas = 0;
    let saidas = 0;
    let dinheiro = Number(caixaAtual?.valor_abertura ?? 0);
    let temAbertura = false;
    for (const m of movimentos) {
      const v = Number(m.valor);
      if (m.tipo === "abertura") temAbertura = true;
      if (entradaCaixa(m.tipo)) {
        if (m.tipo !== "abertura") entradas += v;
        if ((m.forma_pagamento ?? "dinheiro") === "dinheiro") dinheiro += m.tipo === "abertura" ? 0 : v;
      } else {
        saidas += v;
        if ((m.forma_pagamento ?? "dinheiro") === "dinheiro") dinheiro -= v;
      }
    }
    if (temAbertura) {
      // o valor de abertura já está incluído no valor inicial acima
    }
    return { entradas, saidas, dinheiro };
  }, [movimentos, caixaAtual]);

  /** Vendas de balcão (PDV) lançadas neste caixa, separadas por depósito de saída. */
  const vendasPdv = useMemo(() => {
    const mapa = new Map<string, { deposito: string; vendas: number; valor: number }>();
    let total = 0;
    for (const m of movimentos) {
      if (m.tipo !== "venda") continue;
      const nome = nomeDeposito(m) ?? "Sem depósito informado";
      const atual = mapa.get(nome) ?? { deposito: nome, vendas: 0, valor: 0 };
      atual.vendas += 1;
      atual.valor += Number(m.valor);
      mapa.set(nome, atual);
      total += Number(m.valor);
    }
    return {
      total,
      lista: [...mapa.values()].sort((a, b) => b.valor - a.valor),
    };
  }, [movimentos]);

  const abrir = useMutation({
    mutationFn: async () => {
      let alvo = filialId;
      if (!alvo) {
        const { data } = await supabase.from("filiais").select("id").order("nome").limit(1);
        alvo = data?.[0]?.id ?? null;
      }
      if (!alvo) throw new Error("Nenhuma filial cadastrada para abrir o caixa");
      const { error } = await supabase.rpc("abrir_caixa", {
        p_filial_id: alvo,
        p_valor_abertura: Number(valorAbertura.replace(",", ".") || 0),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Caixa aberto.");
      setAbrirAberto(false);
      void queryClient.invalidateQueries({ queryKey: ["caixas"] });
      void queryClient.invalidateQueries({ queryKey: ["caixa-aberto"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const lancar = useMutation({
    mutationFn: async () => {
      if (!caixaAtual) throw new Error("Nenhum caixa aberto");
      const { error } = await supabase.rpc("caixa_movimento", {
        p_caixa_id: caixaAtual.id,
        p_tipo: tipoMov as never,
        p_valor: Number(valorMov.replace(",", ".") || 0),
        p_descricao: descMov,
        p_forma: formaMov as never,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Movimento lançado.");
      setMovAberto(false);
      setValorMov("");
      setDescMov("");
      void queryClient.invalidateQueries({ queryKey: ["caixa-movimentos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const fechar = useMutation({
    mutationFn: async () => {
      if (!caixaAtual) throw new Error("Nenhum caixa aberto");
      const { data, error } = await supabase.rpc("fechar_caixa", {
        p_caixa_id: caixaAtual.id,
        p_valor_informado: Number(valorInformado.replace(",", ".") || 0),
        p_observacao: obsFechamento,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: (dif) => {
      toast.success(
        dif === 0
          ? "Caixa fechado sem diferença."
          : `Caixa fechado com diferença de ${brl(dif)}.`,
      );
      setFecharAberto(false);
      setValorInformado("");
      setObsFechamento("");
      void queryClient.invalidateQueries({ queryKey: ["caixas"] });
      void queryClient.invalidateQueries({ queryKey: ["caixa-aberto"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Caixa"
        description="Abertura, movimentos do dia e fechamento com conferência de valores."
        actions={
          caixaAtual ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setTipoMov("entrada");
                  setMovAberto(true);
                }}
              >
                <ArrowUpCircle className="size-4" /> Lançar movimento
              </Button>
              <Button
                onClick={() => {
                  setValorInformado(resumo.dinheiro.toFixed(2));
                  setFecharAberto(true);
                }}
              >
                <Lock className="size-4" /> Fechar caixa
              </Button>
            </>
          ) : (
            <Button onClick={() => setAbrirAberto(true)}>
              <Unlock className="size-4" /> Abrir caixa
            </Button>
          )
        }
      />

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : !caixaAtual ? (
        <EmptyState
          title="Nenhum caixa aberto."
          description="Abra o caixa informando o valor inicial em dinheiro."
          action={
            <Button onClick={() => setAbrirAberto(true)}>
              <Unlock className="size-4" /> Abrir caixa
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Abertura"
              value={brl(Number(caixaAtual.valor_abertura))}
              hint={dateTimeBR(caixaAtual.aberto_em)}
              icon={Wallet}
            />
            <StatCard label="Entradas" value={brl(resumo.entradas)} tone="success" icon={ArrowUpCircle} />
            <StatCard label="Saídas" value={brl(resumo.saidas)} tone="danger" icon={ArrowDownCircle} />
            <StatCard label="Saldo em dinheiro" value={brl(resumo.dinheiro)} tone="accent" />
          </div>

          <div className="panel mb-5 p-4">
            <h2 className="mb-3 font-display text-lg font-semibold">
              Movimentos do caixa nº {caixaAtual.numero}
            </h2>
            {movimentos.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Nenhum movimento lançado ainda.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Quando</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Depósito</TableHead>
                      <TableHead>Forma</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movimentos.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="text-sm">{dateTimeBR(m.created_at)}</TableCell>
                        <TableCell>
                          <Badge
                            className={
                              entradaCaixa(m.tipo)
                                ? "bg-success/15 text-success"
                                : "bg-destructive/15 text-destructive"
                            }
                          >
                            {m.tipo}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{m.descricao ?? "—"}</TableCell>
                        <TableCell className="text-sm">{nomeDeposito(m) ?? "—"}</TableCell>
                        <TableCell className="text-sm">{labelForma(m.forma_pagamento)}</TableCell>
                        <TableCell className="text-right text-numeric">
                          {entradaCaixa(m.tipo) ? "" : "-"}
                          {brl(Number(m.valor))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </>
      )}

      <div className="panel p-4">
        <h2 className="mb-3 font-display text-lg font-semibold">Últimos fechamentos</h2>
        {caixas.filter((c) => c.situacao === "fechado").length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nenhum caixa fechado ainda.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nº</TableHead>
                  <TableHead>Aberto em</TableHead>
                  <TableHead>Fechado em</TableHead>
                  <TableHead className="text-right">Esperado</TableHead>
                  <TableHead className="text-right">Informado</TableHead>
                  <TableHead className="text-right">Diferença</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {caixas
                  .filter((c) => c.situacao === "fechado")
                  .map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="text-numeric">{c.numero}</TableCell>
                      <TableCell className="text-sm">{dateTimeBR(c.aberto_em)}</TableCell>
                      <TableCell className="text-sm">{dateTimeBR(c.fechado_em)}</TableCell>
                      <TableCell className="text-right text-numeric">
                        {brl(Number(c.valor_esperado ?? 0))}
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {brl(Number(c.valor_informado ?? 0))}
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        <span
                          className={
                            Number(c.diferenca ?? 0) === 0 ? "" : "font-semibold text-destructive"
                          }
                        >
                          {brl(Number(c.diferenca ?? 0))}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={abrirAberto} onOpenChange={setAbrirAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abrir caixa</DialogTitle>
          </DialogHeader>
          <div>
            <Label>Valor inicial em dinheiro</Label>
            <Input value={valorAbertura} onChange={(e) => setValorAbertura(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbrirAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => abrir.mutate()} disabled={abrir.isPending}>
              Abrir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={movAberto} onOpenChange={setMovAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lançar movimento</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Tipo</Label>
              <Select value={tipoMov} onValueChange={setTipoMov}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tiposCaixaMov.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Valor</Label>
                <Input value={valorMov} onChange={(e) => setValorMov(e.target.value)} />
              </div>
              <div>
                <Label>Forma</Label>
                <Select value={formaMov} onValueChange={setFormaMov}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {formasPagamento.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Descrição</Label>
              <Input value={descMov} onChange={(e) => setDescMov(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMovAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => lancar.mutate()} disabled={lancar.isPending}>
              Lançar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={fecharAberto} onOpenChange={setFecharAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fechar caixa</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              Saldo esperado em dinheiro: <strong>{brl(resumo.dinheiro)}</strong>
            </p>
            <div>
              <Label>Valor conferido na gaveta</Label>
              <Input value={valorInformado} onChange={(e) => setValorInformado(e.target.value)} />
            </div>
            <div>
              <Label>Observação</Label>
              <Textarea
                value={obsFechamento}
                onChange={(e) => setObsFechamento(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFecharAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => fechar.mutate()} disabled={fechar.isPending}>
              Fechar caixa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
