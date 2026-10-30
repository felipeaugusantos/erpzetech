import { Fragment, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ListChecks, Plus, Trash2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useManufatura } from "@/hooks/useManufatura";
import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR } from "@/lib/format";
import {
  PERFIS_GESTAO_MANUFATURA,
  SITUACAO_ORDEM,
  erroDoItem,
  custoMaoDeObra,
  custoPadraoDaOrdem,
  necessidadeDoItem,
  precoSugerido,
  formatarMinutos,
  formatarQuantidadeMf,
  itensParaBanco,
  type LinhaItemForm,
  type SituacaoOrdem,
} from "@/lib/manufatura";

export const Route = createFileRoute("/_authenticated/manufatura-ordens")({
  head: () => ({
    meta: [
      { title: "Ordens de produção — EZRA ERP" },
      {
        name: "description",
        content:
          "Planeje a produção, reserve os insumos, acompanhe o consumo e o custo real de cada ordem.",
      },
    ],
  }),
  component: OrdensModulo,
});

function OrdensModulo() {
  const m = useManufatura();
  if (m.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!m.liberada) return <ManufaturaBloqueada motivo="modulo" />;
  if (!m.temPerfil(PERFIS_GESTAO_MANUFATURA)) return <ManufaturaBloqueada motivo="perfil" />;
  return <Ordens />;
}

const NENHUM = "nenhum";
/** Ordens por página: o filtro de situação vai ao servidor e "Mostrar mais" amplia o limite. */
const POR_PAGINA = 100;

type FormOrdem = {
  descricao: string;
  entrada_estoque: boolean;
  produto_id: string;
  bom_id: string;
  quantidade_planejada: string;
  deposito_insumos_id: string;
  deposito_destino_id: string;
  pedido_id: string;
  medidas: string;
  acabamento: string;
  prazo: string;
  mao_de_obra: string;
};

const formVazio = (): FormOrdem => ({
  descricao: "",
  entrada_estoque: false,
  produto_id: NENHUM,
  bom_id: NENHUM,
  quantidade_planejada: "1",
  deposito_insumos_id: "",
  deposito_destino_id: "",
  pedido_id: NENHUM,
  medidas: "",
  acabamento: "",
  prazo: "",
  mao_de_obra: "0",
});

function lerPreferencia(chave: string, padrao: string): string {
  try {
    return window.localStorage.getItem(chave) ?? padrao;
  } catch {
    return padrao;
  }
}
function guardarPreferencia(chave: string, valor: string) {
  try {
    window.localStorage.setItem(chave, valor);
  } catch {
    // sem armazenamento local: a conta continua valendo na tela
  }
}
const numero = (t: string) => Number((t || "0").replace(",", "."));
const vazioParaNulo = (v: string) => (v === NENHUM || v === "" ? undefined : v);

const COR_SITUACAO: Record<SituacaoOrdem, "default" | "secondary" | "outline" | "destructive"> = {
  planejada: "outline",
  liberada: "secondary",
  em_producao: "default",
  concluida: "default",
  cancelada: "destructive",
};

/** Etapas da ordem com os minutos apontados e o custo da mão de obra (tabela só da gestão, tem custo por hora). */
function EtapasDaOrdem({ ordemId }: { ordemId: string }) {
  const { data: etapas } = useQuery({
    queryKey: ["mf-ordem-etapas", ordemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mf_ordem_etapas")
        .select("*")
        .eq("ordem_id", ordemId)
        .order("ordem")
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });
  if ((etapas?.length ?? 0) === 0) return null;
  return (
    <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
      {etapas!.map((e) => (
        <li
          key={e.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
        >
          <span>{e.nome}</span>
          <span className="text-muted-foreground">
            {formatarMinutos(e.minutos_apontados)} ·{" "}
            {brl(custoMaoDeObra(e.minutos_apontados, Number(e.custo_hora)))} (
            {brl(Number(e.custo_hora))}/h)
          </span>
        </li>
      ))}
    </ul>
  );
}

type ProdutoRef = { id: string; descricao: string; unidade: string; custo?: number | null };

/** Insumos de uma ordem, buscados só quando a linha é aberta (e só os dela). */
function InsumosDaOrdem({ ordemId, produtos }: { ordemId: string; produtos: ProdutoRef[] }) {
  const { data: itens, isLoading } = useQuery({
    queryKey: ["mf-ordem-insumos", ordemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mf_ordem_insumos")
        .select("*")
        .eq("ordem_id", ordemId);
      if (error) throw error;
      return data ?? [];
    },
  });
  const produto = (id: string) => produtos.find((p) => p.id === id);
  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando insumos…</p>;
  if ((itens?.length ?? 0) === 0)
    return <p className="text-sm text-muted-foreground">Sem insumos ainda: use "Itens".</p>;
  return (
    <ul className="grid gap-1.5 sm:grid-cols-2">
      {itens!.map((i) => (
        <li
          key={i.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm"
        >
          <span>{produto(i.insumo_id)?.descricao ?? "Insumo"}</span>
          <span className="text-muted-foreground">
            plan. {formatarQuantidadeMf(Number(i.quantidade_planejada))} · cons.{" "}
            {formatarQuantidadeMf(Number(i.quantidade_consumida))} · res.{" "}
            {formatarQuantidadeMf(Number(i.quantidade_reservada))}{" "}
            {produto(i.insumo_id)?.unidade ?? ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Ordens() {
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState<string>("abertas");
  const [limite, setLimite] = useState(POR_PAGINA);
  const [aberta, setAberta] = useState<string | null>(null);
  const [novo, setNovo] = useState<FormOrdem | null>(null);
  const [itensDe, setItensDe] = useState<string | null>(null);
  const [itensForm, setItensForm] = useState<LinhaItemForm[]>([]);
  const [maoDeObra, setMaoDeObra] = useState("0");
  const [margemAlvo, setMargemAlvo] = useState(() => lerPreferencia("mf-margem-alvo", "30"));
  const [despesasVenda, setDespesasVenda] = useState(() =>
    lerPreferencia("mf-despesas-venda", "0"),
  );

  const { data, isLoading } = useQuery({
    queryKey: ["mf-ordens", filtro, limite],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      // o filtro de situação é aplicado antes do limite: ordem antiga ainda em aberto nunca some da tela
      let consulta = supabase
        .from("mf_ordens")
        .select("*")
        .order("numero", { ascending: false })
        .limit(limite);
      if (filtro === "abertas")
        consulta = consulta.in("situacao", ["planejada", "liberada", "em_producao"]);
      else if (filtro !== "todas") consulta = consulta.eq("situacao", filtro);
      const [ordens, produtos, depositos, boms, pedidos] = await Promise.all([
        consulta,
        supabase
          .from("produtos")
          .select("id, descricao, unidade, custo")
          .eq("ativo", true)
          .order("descricao")
          .limit(2000),
        supabase.from("depositos").select("id, nome").order("nome"),
        supabase
          .from("mf_boms")
          .select("id, produto_id, versao, rotulo, situacao")
          .neq("situacao", "rascunho"),
        supabase
          .from("pedidos")
          .select("id, numero")
          .order("numero", { ascending: false })
          .limit(300),
      ]);
      for (const r of [ordens, produtos, depositos, boms, pedidos]) if (r.error) throw r.error;
      return {
        ordens: ordens.data ?? [],
        produtos: produtos.data ?? [],
        depositos: depositos.data ?? [],
        boms: boms.data ?? [],
        pedidos: pedidos.data ?? [],
      };
    },
  });
  const produto = (id: string | null) => (id ? data?.produtos.find((p) => p.id === id) : undefined);
  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ["mf-ordens"] });
    void qc.invalidateQueries({ queryKey: ["mf-ordem-insumos"] });
    void qc.invalidateQueries({ queryKey: ["mf-ordem-etapas"] });
  };

  const criar = useMutation({
    mutationFn: async (f: FormOrdem) => {
      if (!f.descricao.trim()) throw new Error("Descreva a ordem de produção.");
      if (numero(f.quantidade_planejada) <= 0)
        throw new Error("A quantidade precisa ser maior que zero.");
      if (!f.deposito_insumos_id) throw new Error("Escolha o depósito dos insumos.");
      if (f.entrada_estoque && (f.produto_id === NENHUM || !f.deposito_destino_id))
        throw new Error(
          "Para dar entrada no estoque, escolha o produto acabado e o depósito de destino.",
        );
      const { data: id, error } = await supabase.rpc("mf_ordem_criar", {
        p_dados: {
          descricao: f.descricao,
          entrada_estoque: f.entrada_estoque,
          produto_id: vazioParaNulo(f.produto_id),
          bom_id: vazioParaNulo(f.bom_id),
          quantidade_planejada: numero(f.quantidade_planejada),
          deposito_insumos_id: f.deposito_insumos_id,
          deposito_destino_id: f.entrada_estoque ? vazioParaNulo(f.deposito_destino_id) : undefined,
          pedido_id: vazioParaNulo(f.pedido_id),
          medidas: f.medidas,
          acabamento: f.acabamento,
          prazo: f.prazo || undefined,
          mao_de_obra: numero(f.mao_de_obra),
        },
      });
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      toast.success("Ordem criada. Ajuste os itens se precisar e libere para reservar os insumos.");
      setNovo(null);
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const acao = useMutation({
    mutationFn: async ({
      fn,
      id,
    }: {
      fn: "mf_ordem_liberar" | "mf_ordem_concluir" | "mf_ordem_cancelar";
      id: string;
    }) => {
      const { error } = await supabase.rpc(fn, { p_id: id });
      if (error) throw error;
      return fn;
    },
    onSuccess: (fn) => {
      toast.success(
        fn === "mf_ordem_liberar"
          ? "Ordem liberada: insumos reservados."
          : fn === "mf_ordem_concluir"
            ? "Ordem concluída."
            : "Ordem cancelada.",
      );
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const salvarItens = useMutation({
    mutationFn: async () => {
      if (!itensDe) return;
      for (const l of itensForm) {
        const e = erroDoItem(l);
        if (e) throw new Error(e);
      }
      const { error } = await supabase.rpc("mf_ordem_itens_salvar", {
        p_ordem_id: itensDe,
        p_itens: itensParaBanco(itensForm),
        p_mao_de_obra: numero(maoDeObra),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Itens salvos.");
      setItensDe(null);
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Busca os itens desta ordem (e só dela) antes de abrir o editor: salvar troca todos os itens, então a lista precisa estar completa. */
  async function abrirItens(id: string) {
    const o = data?.ordens.find((x) => x.id === id);
    const { data: itens, error } = await supabase
      .from("mf_ordem_insumos")
      .select("*")
      .eq("ordem_id", id);
    if (error || !itens) {
      toast.error("Não foi possível carregar os itens da ordem. Tente de novo.");
      return;
    }
    if (itens.length >= 1000) {
      toast.error("Esta ordem tem itens demais para editar aqui.");
      return;
    }
    setItensForm(
      itens.map((i) => ({
        insumo_id: i.insumo_id,
        quantidade: String(i.quantidade_base),
        perda_percentual: String(i.perda_percentual),
      })),
    );
    setMaoDeObra(String(o?.mao_de_obra ?? 0));
    setItensDe(id);
  }

  const lista = data?.ordens ?? [];
  // preço sugerido da ordem em edição: insumos (com perda) pelo custo de referência, mais a mão de obra informada
  const ordemDosItens = lista.find((o) => o.id === itensDe);
  const qtdDaOrdem = Number(ordemDosItens?.quantidade_planejada ?? 0);
  const custoDosItens = custoPadraoDaOrdem(
    itensForm.map((l) => ({
      quantidadePlanejada: necessidadeDoItem(
        numero(l.quantidade),
        qtdDaOrdem,
        numero(l.perda_percentual),
      ),
      custoUnitario: Number(produto(l.insumo_id)?.custo ?? 0),
    })),
    numero(maoDeObra),
  );
  const preco = precoSugerido(custoDosItens, numero(margemAlvo), numero(despesasVenda));
  const temMais = lista.length >= limite;
  const bomsDoProduto = (data?.boms ?? []).filter((b) => b.produto_id === novo?.produto_id);

  return (
    <div>
      <PageHeader
        title="Ordens de produção"
        description="Planeje, reserve os insumos, acompanhe o consumo e feche o custo real de cada ordem."
        actions={
          <>
            <Select
              value={filtro}
              onValueChange={(v) => {
                setFiltro(v);
                setLimite(POR_PAGINA);
              }}
            >
              <SelectTrigger className="w-44" aria-label="Filtrar ordens">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="abertas">Em aberto</SelectItem>
                <SelectItem value="todas">Todas</SelectItem>
                {Object.entries(SITUACAO_ORDEM).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => setNovo(formVazio())}>
              <Plus className="mr-2 size-4" /> Nova ordem
            </Button>
          </>
        }
      />

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhuma ordem por aqui"
          description="Crie uma ordem de produção para um pedido sob medida ou para a linha padrão."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Ordem</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Produzido</TableHead>
                <TableHead className="text-right">Custo padrão</TableHead>
                <TableHead className="text-right">Custo real</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((o) => {
                const sit = o.situacao as SituacaoOrdem;
                const expandida = aberta === o.id;
                return (
                  <Fragment key={o.id}>
                    <TableRow>
                      <TableCell>
                        <button
                          type="button"
                          aria-label={expandida ? "Recolher insumos" : "Ver insumos"}
                          aria-expanded={expandida}
                          onClick={() => setAberta(expandida ? null : o.id)}
                          className="grid size-6 place-items-center rounded hover:bg-secondary"
                        >
                          {expandida ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </button>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">
                          OP-{o.numero} · {o.descricao}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {o.entrada_estoque
                            ? `Linha padrão · entra no estoque${produto(o.produto_id) ? ` (${produto(o.produto_id)!.descricao})` : ""}`
                            : "Sob medida · não entra no estoque"}
                          {o.prazo ? ` · prazo ${dateBR(o.prazo)}` : ""}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={COR_SITUACAO[sit]}>
                          {SITUACAO_ORDEM[sit] ?? o.situacao}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {formatarQuantidadeMf(Number(o.quantidade_produzida))} /{" "}
                        {formatarQuantidadeMf(Number(o.quantidade_planejada))}
                        {Number(o.quantidade_refugo) > 0 && (
                          <p className="text-xs text-muted-foreground">
                            refugo {formatarQuantidadeMf(Number(o.quantidade_refugo))}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {brl(Number(o.custo_padrao))}
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {brl(Number(o.custo_real))}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap justify-end gap-2">
                          {sit === "planejada" && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => abrirItens(o.id)}>
                                <ListChecks className="mr-1.5 size-3.5" /> Itens
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => acao.mutate({ fn: "mf_ordem_liberar", id: o.id })}
                                disabled={acao.isPending}
                              >
                                Liberar
                              </Button>
                            </>
                          )}
                          {(sit === "planejada" || sit === "liberada") && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => acao.mutate({ fn: "mf_ordem_cancelar", id: o.id })}
                              disabled={acao.isPending}
                            >
                              Cancelar
                            </Button>
                          )}
                          {sit === "em_producao" && (
                            <Button
                              size="sm"
                              onClick={() => acao.mutate({ fn: "mf_ordem_concluir", id: o.id })}
                              disabled={acao.isPending}
                            >
                              Concluir
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {expandida && (
                      <TableRow>
                        <TableCell />
                        <TableCell colSpan={6}>
                          <InsumosDaOrdem ordemId={o.id} produtos={data?.produtos ?? []} />
                          <EtapasDaOrdem ordemId={o.id} />
                          {(Number(o.mao_de_obra) > 0 || Number(o.custo_mao_obra_apontada) > 0) && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Mão de obra apontada: {brl(Number(o.custo_mao_obra_apontada))} ·
                              informada: {brl(Number(o.mao_de_obra))}
                              {o.medidas ? ` · Medidas: ${o.medidas}` : ""}
                              {o.acabamento ? ` · Acabamento: ${o.acabamento}` : ""}
                            </p>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {temMais && !isLoading && (
        <div className="mt-3 flex justify-center">
          <Button variant="outline" onClick={() => setLimite(limite + POR_PAGINA)}>
            Mostrar mais ordens
          </Button>
        </div>
      )}

      {/* nova ordem */}
      <Dialog open={novo !== null} onOpenChange={(o) => !o && setNovo(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nova ordem de produção</DialogTitle>
          </DialogHeader>
          {novo && (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="op-desc">Descrição</Label>
                <Input
                  id="op-desc"
                  value={novo.descricao}
                  onChange={(e) => setNovo({ ...novo, descricao: e.target.value })}
                  placeholder="Ex.: Armário de cozinha, Sra. Ana"
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                <div>
                  <Label htmlFor="op-entrada">Dar entrada do acabado no estoque</Label>
                  <p className="text-xs text-muted-foreground">
                    Ligue só para a linha padrão. Na encomenda o móvel vai para o cliente e não
                    entra no estoque.
                  </p>
                </div>
                <Switch
                  id="op-entrada"
                  checked={novo.entrada_estoque}
                  onCheckedChange={(v) => setNovo({ ...novo, entrada_estoque: v })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="op-produto">
                    Produto acabado{novo.entrada_estoque ? "" : " (opcional)"}
                  </Label>
                  <Select
                    value={novo.produto_id}
                    onValueChange={(v) => setNovo({ ...novo, produto_id: v, bom_id: NENHUM })}
                  >
                    <SelectTrigger id="op-produto">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NENHUM}>Sem produto cadastrado</SelectItem>
                      {(data?.produtos ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.descricao}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="op-bom">Lista de materiais</Label>
                  <Select
                    value={novo.bom_id}
                    onValueChange={(v) => setNovo({ ...novo, bom_id: v })}
                    disabled={novo.produto_id === NENHUM}
                  >
                    <SelectTrigger id="op-bom">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NENHUM}>Informar os itens depois</SelectItem>
                      {bomsDoProduto.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          Versão {b.versao}
                          {b.rotulo ? ` · ${b.rotulo}` : ""} ({b.situacao})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="op-qtd">Quantidade</Label>
                  <Input
                    id="op-qtd"
                    inputMode="decimal"
                    value={novo.quantidade_planejada}
                    onChange={(e) => setNovo({ ...novo, quantidade_planejada: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="op-prazo">Prazo</Label>
                  <Input
                    id="op-prazo"
                    type="date"
                    value={novo.prazo}
                    onChange={(e) => setNovo({ ...novo, prazo: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="op-mao">Mão de obra (R$)</Label>
                  <Input
                    id="op-mao"
                    inputMode="decimal"
                    value={novo.mao_de_obra}
                    onChange={(e) => setNovo({ ...novo, mao_de_obra: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="op-dep-ins">Depósito dos insumos</Label>
                  <Select
                    value={novo.deposito_insumos_id}
                    onValueChange={(v) => setNovo({ ...novo, deposito_insumos_id: v })}
                  >
                    <SelectTrigger id="op-dep-ins">
                      <SelectValue placeholder="Escolha o depósito" />
                    </SelectTrigger>
                    <SelectContent>
                      {(data?.depositos ?? []).map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {novo.entrada_estoque && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="op-dep-dest">Depósito do acabado</Label>
                    <Select
                      value={novo.deposito_destino_id}
                      onValueChange={(v) => setNovo({ ...novo, deposito_destino_id: v })}
                    >
                      <SelectTrigger id="op-dep-dest">
                        <SelectValue placeholder="Escolha o depósito" />
                      </SelectTrigger>
                      <SelectContent>
                        {(data?.depositos ?? []).map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="op-medidas">Medidas</Label>
                  <Input
                    id="op-medidas"
                    value={novo.medidas}
                    onChange={(e) => setNovo({ ...novo, medidas: e.target.value })}
                    placeholder="Ex.: 2,40 x 0,60 x 2,10 m"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="op-acab">Acabamento</Label>
                  <Input
                    id="op-acab"
                    value={novo.acabamento}
                    onChange={(e) => setNovo({ ...novo, acabamento: e.target.value })}
                    placeholder="Ex.: MDF branco"
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="op-pedido">Pedido (opcional)</Label>
                <Select
                  value={novo.pedido_id}
                  onValueChange={(v) => setNovo({ ...novo, pedido_id: v })}
                >
                  <SelectTrigger id="op-pedido">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NENHUM}>Sem pedido</SelectItem>
                    {(data?.pedidos ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        Pedido {p.numero}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovo(null)}>
              Cancelar
            </Button>
            <Button onClick={() => novo && criar.mutate(novo)} disabled={criar.isPending}>
              Criar ordem
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* itens da ordem planejada */}
      <Dialog open={itensDe !== null} onOpenChange={(o) => !o && setItensDe(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Itens da ordem</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Quantidade por unidade produzida. Os itens só mudam antes da liberação.
          </p>
          <div className="grid gap-2">
            {itensForm.map((l, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[1fr_5.5rem_5.5rem_auto] items-end gap-2 max-sm:grid-cols-2"
              >
                <div className="max-sm:col-span-2">
                  <Select
                    value={l.insumo_id}
                    onValueChange={(v) =>
                      setItensForm(
                        itensForm.map((x, i) => (i === idx ? { ...x, insumo_id: v } : x)),
                      )
                    }
                  >
                    <SelectTrigger aria-label={`Insumo ${idx + 1}`}>
                      <SelectValue placeholder="Insumo" />
                    </SelectTrigger>
                    <SelectContent>
                      {(data?.produtos ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.descricao}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  aria-label={`Quantidade ${idx + 1}`}
                  inputMode="decimal"
                  placeholder="Qtd."
                  value={l.quantidade}
                  onChange={(e) =>
                    setItensForm(
                      itensForm.map((x, i) =>
                        i === idx ? { ...x, quantidade: e.target.value } : x,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`Perda % ${idx + 1}`}
                  inputMode="decimal"
                  placeholder="Perda %"
                  value={l.perda_percentual}
                  onChange={(e) =>
                    setItensForm(
                      itensForm.map((x, i) =>
                        i === idx ? { ...x, perda_percentual: e.target.value } : x,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remover item ${idx + 1}`}
                  onClick={() => setItensForm(itensForm.filter((_, i) => i !== idx))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() =>
                setItensForm([
                  ...itensForm,
                  { insumo_id: "", quantidade: "", perda_percentual: "0" },
                ])
              }
            >
              <Plus className="mr-1.5 size-3.5" /> Adicionar item
            </Button>
          </div>
          <div className="grid gap-1.5 sm:max-w-xs">
            <Label htmlFor="op-mao-itens">Mão de obra (R$)</Label>
            <Input
              id="op-mao-itens"
              inputMode="decimal"
              value={maoDeObra}
              onChange={(e) => setMaoDeObra(e.target.value)}
            />
          </div>
          <div className="rounded-lg border bg-secondary/40 p-3">
            <p className="text-sm font-medium">Preço sugerido</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="op-margem">Margem desejada (%)</Label>
                <Input
                  id="op-margem"
                  inputMode="decimal"
                  value={margemAlvo}
                  onChange={(e) => {
                    setMargemAlvo(e.target.value);
                    guardarPreferencia("mf-margem-alvo", e.target.value);
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="op-despesas">Impostos e comissão (%)</Label>
                <Input
                  id="op-despesas"
                  inputMode="decimal"
                  value={despesasVenda}
                  onChange={(e) => {
                    setDespesasVenda(e.target.value);
                    guardarPreferencia("mf-despesas-venda", e.target.value);
                  }}
                />
              </div>
            </div>
            <dl className="mt-3 grid gap-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Custo (insumos + mão de obra)</dt>
                <dd className="text-numeric">{brl(custoDosItens)}</dd>
              </div>
              <div className="flex justify-between gap-2 font-medium">
                <dt>Preço de venda sugerido</dt>
                <dd className="text-numeric">{preco === null ? "—" : brl(preco)}</dd>
              </div>
              {preco !== null && qtdDaOrdem > 1 && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Por unidade ({qtdDaOrdem})</dt>
                  <dd className="text-numeric">{brl(preco / qtdDaOrdem)}</dd>
                </div>
              )}
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">
              Usa o custo de referência de cada insumo (o custo médio do estoque pode diferir um
              pouco). A margem é sobre o preço, como no relatório de lucro.
              {preco === null &&
                " Informe os itens e uma margem menor que 100% somada às despesas."}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItensDe(null)}>
              Cancelar
            </Button>
            <Button onClick={() => salvarItens.mutate()} disabled={salvarItens.isPending}>
              Salvar itens
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
