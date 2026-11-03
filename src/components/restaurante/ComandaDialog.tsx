import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Check,
  ChefHat,
  GitMerge,
  HandCoins,
  Wallet,
  MoreHorizontal,
  Printer,
  Receipt,
  Send,
  Ticket,
  X,
} from "lucide-react";
import { toast } from "sonner";

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
import { BaixaParcialDialog } from "@/components/restaurante/BaixaParcialDialog";
import { DeliveryPainel } from "@/components/restaurante/DeliveryPainel";
import { CreditoDialog } from "@/components/restaurante/CreditoDialog";
import { DevolverCreditoDialog } from "@/components/restaurante/DevolverCreditoDialog";
import { JuntarContasDialog } from "@/components/restaurante/JuntarContasDialog";
import { FecharContaDialog } from "@/components/restaurante/FecharContaDialog";
import { MotivoDialog } from "@/components/restaurante/MotivoDialog";
import { useCardapio } from "@/hooks/useCardapio";
import { urlFotoCardapio } from "@/lib/cardapio-foto";
import { cardapioSugerido, itensDoCardapio, precoNoCardapio } from "@/lib/cardapios";
import { useRelogio } from "@/hooks/useRelogio";
import { useSessionData } from "@/hooks/useSessionData";
import { imprimirContaComanda, itensDaConta } from "@/components/restaurante/imprimirConta";
import { htmlTicketSenha } from "@/lib/ticket-senha";
import { htmlEtiquetaComanda } from "@/lib/etiqueta-comanda";
import { brl } from "@/lib/format";
import {
  ROTULO_SITUACAO_ITEM,
  calcularConta,
  ehGestaoSalao,
  minutosDesde,
  recebeConta,
  validarOpcoes,
} from "@/lib/restaurante";
import {
  CHAVE_REST,
  rpcRestaurante,
  tabela,
  type CardapioItem,
  type Comanda,
  type ComandaItem,
  type Mesa,
  type PagamentoComanda,
} from "@/lib/restaurante-dados";

type Props = {
  comandaId: string;
  roles: string[];
  mesas: Mesa[];
  mesasLivres: Mesa[];
  onFechar: () => void;
};

/** Comanda aberta: cardápio para lançar itens, andamento dos pedidos e fechamento da conta. */
export function ComandaDialog({ comandaId, roles, mesas, mesasLivres, onFechar }: Props) {
  const qc = useQueryClient();
  const gestao = ehGestaoSalao(roles);
  const agora = useRelogio();
  const { data: sessao } = useSessionData();
  const [categoria, setCategoria] = useState<string>("todas");
  const [busca, setBusca] = useState("");
  const [escolhendo, setEscolhendo] = useState<CardapioItem | null>(null);
  const [cardapioSel, setCardapioSel] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState<ComandaItem | "comanda" | null>(null);
  const [transferindo, setTransferindo] = useState(false);
  const [destino, setDestino] = useState("");
  const [fechando, setFechando] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [creditando, setCreditando] = useState(false);
  const [juntando, setJuntando] = useState(false);
  const [devolvendo, setDevolvendo] = useState(false);

  const { data: cardapio } = useCardapio();

  const { data: comanda } = useQuery({
    queryKey: [CHAVE_REST, "comanda", comandaId],
    queryFn: async () => {
      const { data, error } = await tabela("comandas")
        .select("*")
        .eq("id", comandaId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as unknown as Comanda | null;
    },
  });

  const { data: itens = [] } = useQuery({
    queryKey: [CHAVE_REST, "comanda-itens", comandaId],
    queryFn: async () => {
      const { data, error } = await tabela("comanda_itens")
        .select("*")
        .eq("comanda_id", comandaId)
        .order("created_at");
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ComandaItem[];
    },
  });

  // só quem recebe a conta lê os pagamentos (o banco recusa para garçom e cozinha)
  const { data: pagamentos = [] } = useQuery({
    queryKey: [CHAVE_REST, "comanda-pagamentos", comandaId],
    enabled: recebeConta(roles),
    queryFn: async () => {
      const { data, error } = await tabela("comanda_pagamentos")
        .select("*")
        .eq("comanda_id", comandaId)
        .order("created_at");
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as PagamentoComanda[];
    },
  });
  const jaPago = Math.round(pagamentos.reduce((s, p) => s + Number(p.valor), 0) * 100) / 100;

  // a taxa de entrega é um item interno escondido do cardápio; a tela do delivery a trata à parte
  const { data: taxaItemId = null } = useQuery({
    queryKey: [CHAVE_REST, "taxa-entrega-item"],
    enabled: comanda?.tipo === "delivery",
    queryFn: async () => {
      const { data, error } = await tabela("cardapio_itens")
        .select("id")
        .eq("interno", true)
        .eq("nome", "Taxa de entrega")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as unknown as { id: string } | null)?.id ?? null;
    },
  });

  const atualizar = () => void qc.invalidateQueries({ queryKey: [CHAVE_REST] });

  // cardápios em uso nesta comanda (salão ou delivery); o sugerido segue o horário, e dá para trocar
  const menusUso = (cardapio?.cardapios ?? []).filter(
    (m) => m.ativo && (comanda?.tipo === "delivery" ? m.uso_delivery : m.uso_salao),
  );
  const menuAtual =
    menusUso.find((m) => m.id === cardapioSel) ?? cardapioSugerido(menusUso, agora) ?? null;
  const erro = (e: Error) => toast.error(e.message);

  const lancar = useMutation({
    mutationFn: (p: { item: string; qtd: number; opcoes: string[]; obs: string }) =>
      // com um cardápio em uso, o banco cobra o preço daquele cardápio
      menuAtual
        ? rpcRestaurante("restaurante_lancar_item_no_cardapio", {
            p_comanda_id: comandaId,
            p_cardapio_item_id: p.item,
            p_quantidade: p.qtd,
            p_cardapio_id: menuAtual.id,
            p_opcoes: p.opcoes,
            p_observacao: p.obs || null,
          })
        : rpcRestaurante("restaurante_lancar_item", {
            p_comanda_id: comandaId,
            p_cardapio_item_id: p.item,
            p_quantidade: p.qtd,
            p_opcoes: p.opcoes,
            p_observacao: p.obs || null,
          }),
    onSuccess: atualizar,
    onError: erro,
  });

  const enviar = useMutation({
    mutationFn: () =>
      rpcRestaurante<number>("restaurante_enviar_cozinha", { p_comanda_id: comandaId }),
    onSuccess: (n) => {
      toast.success(n === 1 ? "1 item enviado" : `${n} itens enviados`);
      atualizar();
    },
    onError: erro,
  });

  const andamento = useMutation({
    mutationFn: (p: { id: string; para: string }) =>
      rpcRestaurante("restaurante_atualizar_item", { p_item_id: p.id, p_situacao: p.para }),
    onSuccess: atualizar,
    onError: erro,
  });

  const cancelar = useMutation({
    mutationFn: async (p: { alvo: ComandaItem | "comanda"; motivo: string }) => {
      if (p.alvo === "comanda")
        return rpcRestaurante("restaurante_cancelar_comanda", {
          p_comanda_id: comandaId,
          p_motivo: p.motivo,
        });
      return rpcRestaurante("restaurante_cancelar_item", {
        p_item_id: p.alvo.id,
        p_motivo: p.motivo || null,
      });
    },
    onSuccess: (_, p) => {
      setCancelando(null);
      atualizar();
      if (p.alvo === "comanda") onFechar();
    },
    onError: erro,
  });

  const transferir = useMutation({
    mutationFn: () =>
      rpcRestaurante("restaurante_transferir_mesa", {
        p_comanda_id: comandaId,
        p_mesa_destino: destino,
      }),
    onSuccess: () => {
      toast.success("Comanda transferida");
      setTransferindo(false);
      setDestino("");
      atualizar();
    },
    onError: erro,
  });

  const validos = itens.filter((i) => i.situacao !== "cancelado");
  const subtotal = validos.reduce((s, i) => s + Number(i.total), 0);
  const pendentes = itens.filter((i) => i.situacao === "pendente");
  const naoEntregues = validos.filter((i) =>
    ["enviado", "preparando", "pronto"].includes(i.situacao),
  );
  const aberta = comanda?.situacao === "aberta";
  const mesa = mesas.find((m) => m.id === comanda?.mesa_id);

  const conta = comanda
    ? calcularConta({
        subtotal,
        pessoas: comanda.pessoas,
        couvertPorPessoa: Number(comanda.couvert_por_pessoa),
        taxaServicoPercentual: Number(comanda.taxa_servico_percentual),
        cobrarServico: true,
        desconto: 0,
        jaPago,
      })
    : null;

  // sobra: recebido acima do total atual da conta (com serviço e couvert), a devolver ao cliente
  const sobraCredito = conta ? Math.round((jaPago - (conta.total ?? 0)) * 100) / 100 : 0;
  const rotuloConta = mesa ? `mesa ${mesa.numero}` : `comanda ${comanda?.numero ?? ""}`;

  const itensFiltrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    // item por peso só entra pela Balança (o banco recusa o lançamento comum)
    const base = menuAtual
      ? itensDoCardapio(cardapio?.itens ?? [], cardapio?.vinculos ?? [], menuAtual.id)
      : (cardapio?.itens ?? []);
    return base
      .filter((i) => !i.venda_por_peso)
      .filter(
        (i) =>
          (categoria === "todas" || i.categoria_id === categoria) &&
          (!t || i.nome.toLowerCase().includes(t)),
      );
  }, [cardapio, categoria, busca, menuAtual]);

  function tocar(item: CardapioItem) {
    const grupos = (cardapio?.grupos ?? []).filter((g) => g.item_id === item.id);
    if (grupos.length > 0) setEscolhendo(item);
    else lancar.mutate({ item: item.id, qtd: 1, opcoes: [], obs: "" });
  }

  /** Etiqueta com o código de barras da comanda: depois é só bipar no leitor do PDV. */
  function imprimirEtiqueta() {
    if (!comanda) return;
    const janela = window.open("", "_blank", "width=420,height=560");
    if (!janela) {
      toast.error("O navegador bloqueou a janela de impressão");
      return;
    }
    janela.document.write(
      htmlEtiquetaComanda({
        numero: comanda.numero,
        mesa: mesa?.numero ?? null,
        cliente: comanda.cliente_nome,
        loja: sessao?.empresa?.nome_fantasia || sessao?.empresa?.razao_social || null,
      }),
    );
    janela.document.close();
    janela.focus();
    setTimeout(() => janela.print(), 300);
  }

  /** Senha do pedido de balcão: envia o pedido à produção e imprime o ticket. */
  const emitirSenha = useMutation({
    mutationFn: async (janela: Window | null) => {
      if (!comanda) throw new Error("Comanda não carregada");
      const r = await rpcRestaurante<{ senha: number; enviados: number; nova: boolean }>(
        "restaurante_emitir_senha",
        { p_comanda_id: comanda.id },
      );
      return { r, janela };
    },
    onSuccess: ({ r, janela }) => {
      toast.success(
        r.nova ? `Senha ${r.senha} emitida e pedido enviado` : `Senha ${r.senha} (reimpressa)`,
      );
      if (janela && comanda) {
        janela.document.write(
          htmlTicketSenha({
            loja: sessao?.empresa?.nome_fantasia || sessao?.empresa?.razao_social || null,
            senha: r.senha,
            comanda: comanda.numero,
            itens: validos.map((i) => ({
              nome: i.nome,
              quantidade: Number(i.quantidade),
              observacao: i.observacao,
            })),
            emitidoEm: new Date().toLocaleString("pt-BR"),
          }),
        );
        janela.document.close();
        janela.focus();
        setTimeout(() => janela.print(), 300);
      }
      atualizar();
    },
    onError: (e: Error, janela) => {
      janela?.close();
      toast.error(e.message);
    },
  });

  function pedirSenha() {
    // a janela de impressão abre no clique, antes de chamar o banco
    const janela = window.open("", "_blank", "width=420,height=640");
    emitirSenha.mutate(janela);
  }

  /** Conta para conferência na mesa: o cliente vê o total com e sem o serviço opcional. */
  function imprimirConta() {
    if (!comanda) return;
    imprimirContaComanda({
      numero: comanda.numero,
      mesa: mesa?.numero ?? null,
      cliente: comanda.cliente_nome,
      loja: sessao?.empresa?.nome_fantasia || sessao?.empresa?.razao_social || null,
      itens: itensDaConta(itens),
      pessoas: comanda.pessoas,
      couvertPorPessoa: Number(comanda.couvert_por_pessoa),
      taxaServicoPercentual: Number(comanda.taxa_servico_percentual),
      servico: "opcional",
      jaPago,
    });
  }

  function pedirCancelamentoItem(i: ComandaItem) {
    // item ainda não enviado sai direto; o já enviado pede o motivo (e é só da gestão)
    if (i.situacao === "pendente") cancelar.mutate({ alvo: i, motivo: "" });
    else setCancelando(i);
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onFechar()}>
        <DialogContent className="max-h-[92vh] max-w-6xl overflow-hidden p-0">
          <DialogHeader className="border-b px-5 py-3">
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {mesa
                ? `Mesa ${mesa.numero}`
                : comanda?.tipo === "delivery"
                  ? "Delivery"
                  : "Comanda avulsa"}
              <span className="text-sm font-normal text-muted-foreground">
                nº {comanda?.numero ?? "—"}
                {comanda?.pessoas ? ` · ${comanda.pessoas} pessoas` : ""}
                {comanda?.cliente_nome ? ` · ${comanda.cliente_nome}` : ""}
                {comanda ? ` · aberta há ${minutosDesde(comanda.aberta_em, agora)} min` : ""}
              </span>
              {comanda && comanda.situacao !== "aberta" && (
                <Badge variant="secondary">{comanda.situacao}</Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="grid max-h-[calc(92vh-4rem)] gap-0 overflow-hidden lg:grid-cols-[1fr_24rem]">
            {/* Cardápio */}
            <section className="flex min-h-0 flex-col border-b p-4 lg:border-b-0 lg:border-r">
              {aberta ? (
                <>
                  <div className="mb-3 flex flex-wrap gap-2">
                    <Input
                      className="h-9 w-full sm:w-56"
                      placeholder="Buscar no cardápio"
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      aria-label="Buscar no cardápio"
                    />
                    {menusUso.length > 1 && (
                      <div className="flex flex-wrap gap-1" role="group" aria-label="Cardápio">
                        {menusUso.map((m) => (
                          <Chip
                            key={m.id}
                            ativo={menuAtual?.id === m.id}
                            onClick={() => setCardapioSel(m.id)}
                          >
                            {m.nome}
                          </Chip>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1">
                      <Chip ativo={categoria === "todas"} onClick={() => setCategoria("todas")}>
                        Todas
                      </Chip>
                      {(cardapio?.categorias ?? []).map((c) => (
                        <Chip
                          key={c.id}
                          ativo={categoria === c.id}
                          onClick={() => setCategoria(c.id)}
                        >
                          {c.nome}
                        </Chip>
                      ))}
                    </div>
                  </div>
                  <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                    {itensFiltrados.map((i) => (
                      <div key={i.id} className="relative">
                        <button
                          type="button"
                          onClick={() => tocar(i)}
                          disabled={lancar.isPending}
                          className="h-full w-full rounded-lg border bg-card p-3 text-left transition hover:border-primary hover:bg-secondary disabled:opacity-60"
                        >
                          {urlFotoCardapio(i.foto_path) && (
                            <img
                              src={urlFotoCardapio(i.foto_path)!}
                              alt=""
                              loading="lazy"
                              className="mb-2 h-20 w-full rounded object-cover"
                            />
                          )}
                          <span className="block pr-6 font-medium leading-tight">{i.nome}</span>
                          <span className="mt-1 block text-sm text-muted-foreground">
                            {brl(
                              precoNoCardapio(i, cardapio?.vinculos ?? [], menuAtual?.id ?? null),
                            )}
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Quantidade e observação de ${i.nome}`}
                          onClick={() => setEscolhendo(i)}
                          className="absolute right-1 top-1 rounded p-1 text-muted-foreground hover:bg-secondary"
                        >
                          <MoreHorizontal className="size-4" />
                        </button>
                      </div>
                    ))}
                    {itensFiltrados.length === 0 && (
                      <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
                        Nenhum item do cardápio encontrado.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Esta comanda já foi encerrada.
                </p>
              )}
            </section>

            {/* Pedido e conta */}
            <section className="flex min-h-0 flex-col p-4">
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {comanda?.tipo === "delivery" && (
                  <DeliveryPainel
                    comanda={comanda}
                    itens={itens}
                    total={conta?.total ?? 0}
                    taxaItemId={taxaItemId}
                  />
                )}
                {itens.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Nenhum item lançado.
                  </p>
                )}
                {itens.map((i) => (
                  <div
                    key={i.id}
                    className={`rounded border p-2 text-sm ${i.situacao === "cancelado" ? "opacity-50" : ""} ${i.situacao === "pronto" ? "border-emerald-500 bg-emerald-50" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className={i.situacao === "cancelado" ? "line-through" : ""}>
                        <span className="font-medium">
                          {Number(i.quantidade)}× {i.nome}
                        </span>
                        {i.opcoes.length > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            {i.opcoes.map((o) => o.nome).join(", ")}
                          </span>
                        )}
                        {i.observacao && (
                          <span className="block text-xs italic text-muted-foreground">
                            {i.observacao}
                          </span>
                        )}
                      </div>
                      <span className="whitespace-nowrap">{brl(i.total)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <Badge variant={i.situacao === "pronto" ? "default" : "secondary"}>
                        {ROTULO_SITUACAO_ITEM[i.situacao]}
                      </Badge>
                      {i.pago_em && (
                        <Badge variant="outline" className="border-emerald-600 text-emerald-700">
                          Pago{i.pagante ? ` · ${i.pagante}` : ""}
                        </Badge>
                      )}
                      {aberta && (
                        <div className="flex gap-1">
                          {i.situacao === "pronto" && (
                            <Button
                              size="sm"
                              onClick={() => andamento.mutate({ id: i.id, para: "entregue" })}
                              disabled={andamento.isPending}
                            >
                              <Check className="mr-1 size-4" /> Entregar
                            </Button>
                          )}
                          {i.situacao !== "cancelado" &&
                            !i.pago_em &&
                            (i.situacao === "pendente" ||
                              (gestao && i.situacao !== "entregue")) && (
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`Cancelar ${i.nome}`}
                                onClick={() => pedirCancelamentoItem(i)}
                              >
                                <X className="size-4" />
                              </Button>
                            )}
                          {gestao && (i.situacao === "enviado" || i.situacao === "preparando") && (
                            <Button
                              size="sm"
                              variant="outline"
                              title="Dar como entregue (item esquecido na cozinha)"
                              onClick={() => andamento.mutate({ id: i.id, para: "entregue" })}
                            >
                              Entregue
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {conta && (
                <div className="mt-3 space-y-1 border-t pt-3 text-sm">
                  <Linha rotulo="Consumo" valor={conta.subtotal} />
                  {conta.couvert > 0 && <Linha rotulo="Couvert" valor={conta.couvert} />}
                  {conta.servico > 0 && (
                    <Linha
                      rotulo={`Serviço (${comanda?.taxa_servico_percentual}%)`}
                      valor={conta.servico}
                    />
                  )}
                  <div className="flex justify-between font-display text-lg font-bold">
                    <span>Total</span>
                    <span>{brl(conta.total)}</span>
                  </div>
                  {conta.jaPago > 0 && (
                    <>
                      <Linha rotulo="Já recebido" valor={-conta.jaPago} />
                      <div className="flex justify-between font-semibold">
                        <span>Falta receber</span>
                        <span>{brl(conta.restante)}</span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {aberta && (
                <div className="mt-3 grid gap-2">
                  <Button
                    onClick={() => enviar.mutate()}
                    disabled={pendentes.length === 0 || enviar.isPending}
                  >
                    <Send className="mr-2 size-4" />
                    Enviar à cozinha{pendentes.length ? ` (${pendentes.length})` : ""}
                  </Button>
                  <div className="grid grid-cols-2 gap-2">
                    {comanda?.tipo !== "delivery" && (
                      <Button variant="outline" onClick={imprimirEtiqueta}>
                        <Printer className="mr-1 size-4" /> Imprimir comanda
                      </Button>
                    )}
                    {comanda?.tipo !== "delivery" && validos.length > 0 && (
                      <Button variant="outline" onClick={imprimirConta}>
                        <Receipt className="mr-1 size-4" /> Imprimir conta
                      </Button>
                    )}
                    {mesa && (
                      <Button variant="outline" onClick={() => setTransferindo(true)}>
                        <ArrowRightLeft className="mr-1 size-4" /> Mudar de mesa
                      </Button>
                    )}
                    {gestao && (
                      <Button
                        variant="outline"
                        onClick={() => setCancelando("comanda")}
                        disabled={jaPago > 0}
                        title={jaPago > 0 ? "Já houve recebimento: feche a conta" : undefined}
                      >
                        Cancelar comanda
                      </Button>
                    )}
                  </div>
                  {comanda?.tipo === "salao" && !comanda.mesa_id && validos.length > 0 && (
                    <Button variant="outline" onClick={pedirSenha} disabled={emitirSenha.isPending}>
                      <Ticket className="mr-2 size-4" />
                      {comanda.senha
                        ? `Reimprimir senha ${comanda.senha}`
                        : "Emitir senha e enviar à produção"}
                    </Button>
                  )}
                  {comanda?.tipo !== "delivery" && (
                    <Button variant="outline" onClick={() => setJuntando(true)}>
                      <GitMerge className="mr-2 size-4" /> Juntar contas
                    </Button>
                  )}
                  {recebeConta(roles) && (
                    <Button variant="outline" onClick={() => setCreditando(true)}>
                      <Wallet className="mr-2 size-4" /> Adicionar crédito
                    </Button>
                  )}
                  {conta?.pagoExcede && (
                    <p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm">
                      O recebido passa do total da conta em {brl(sobraCredito)}. Devolva a sobra
                      para poder fechar.
                      {gestao ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-2"
                          onClick={() => setDevolvendo(true)}
                        >
                          Devolver sobra
                        </Button>
                      ) : (
                        " A devolução é feita pela gestão."
                      )}
                    </p>
                  )}
                  {recebeConta(roles) && (
                    <Button
                      variant="outline"
                      onClick={() => setBaixando(true)}
                      disabled={!conta || conta.restante <= 0}
                    >
                      <HandCoins className="mr-2 size-4" /> Receber uma parte
                    </Button>
                  )}
                  {recebeConta(roles) ? (
                    <Button
                      variant="secondary"
                      onClick={() => setFechando(true)}
                      disabled={pendentes.length > 0 || naoEntregues.length > 0}
                    >
                      <ChefHat className="mr-2 size-4" /> Fechar a conta
                    </Button>
                  ) : (
                    <p className="text-center text-xs text-muted-foreground">
                      Para receber, chame o caixa. Total da conta: {brl(conta?.total ?? 0)}.
                    </p>
                  )}
                  {recebeConta(roles) && (pendentes.length > 0 || naoEntregues.length > 0) && (
                    <p className="text-center text-xs text-muted-foreground">
                      {pendentes.length > 0
                        ? "Envie ou cancele os itens pendentes para fechar."
                        : "Falta entregar itens para fechar."}
                    </p>
                  )}
                </div>
              )}
            </section>
          </div>
        </DialogContent>
      </Dialog>

      {escolhendo && cardapio && (
        <EscolherItemDialog
          item={{
            ...escolhendo,
            preco: precoNoCardapio(escolhendo, cardapio.vinculos, menuAtual?.id ?? null),
          }}
          grupos={cardapio.grupos.filter((g) => g.item_id === escolhendo.id)}
          opcoes={cardapio.opcoes}
          carregando={lancar.isPending}
          onFechar={() => setEscolhendo(null)}
          onConfirmar={(p) =>
            lancar.mutate(
              { item: escolhendo.id, ...p },
              {
                onSuccess: () => setEscolhendo(null),
              },
            )
          }
        />
      )}

      <MotivoDialog
        aberto={cancelando !== null}
        titulo={cancelando === "comanda" ? "Cancelar a comanda" : "Cancelar o item"}
        obrigatorio={
          cancelando === "comanda" || (cancelando !== null && cancelando.situacao !== "pendente")
        }
        carregando={cancelar.isPending}
        onConfirmar={(m) => cancelando && cancelar.mutate({ alvo: cancelando, motivo: m })}
        onFechar={() => setCancelando(null)}
      />

      <Dialog open={transferindo} onOpenChange={setTransferindo}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mudar de mesa</DialogTitle>
          </DialogHeader>
          <Label>Mesa de destino</Label>
          <Select value={destino} onValueChange={setDestino}>
            <SelectTrigger aria-label="Mesa de destino">
              <SelectValue
                placeholder={mesasLivres.length ? "Escolha a mesa" : "Nenhuma mesa livre"}
              />
            </SelectTrigger>
            <SelectContent>
              {mesasLivres.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  Mesa {m.numero}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferindo(false)}>
              Voltar
            </Button>
            <Button onClick={() => transferir.mutate()} disabled={!destino || transferir.isPending}>
              Transferir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {fechando && comanda && (
        <FecharContaDialog
          comanda={comanda}
          subtotalItens={subtotal}
          itens={itens}
          mesaNumero={mesa?.numero ?? null}
          jaPago={jaPago}
          roles={roles}
          onFechar={() => setFechando(false)}
          onFechada={() => {
            setFechando(false);
            onFechar();
          }}
        />
      )}

      {creditando && comanda && (
        <CreditoDialog
          comanda={comanda}
          rotulo={rotuloConta}
          onFechar={() => setCreditando(false)}
        />
      )}

      {juntando && comanda && (
        <JuntarContasDialog
          comanda={comanda}
          rotulo={rotuloConta}
          mesas={mesas}
          gestao={gestao}
          onFechar={() => setJuntando(false)}
        />
      )}

      {devolvendo && comanda && sobraCredito > 0 && (
        <DevolverCreditoDialog
          comanda={comanda}
          sobra={sobraCredito}
          onFechar={() => setDevolvendo(false)}
        />
      )}

      {baixando && comanda && (
        <BaixaParcialDialog
          comanda={comanda}
          itens={itens}
          subtotalItens={subtotal}
          jaPago={jaPago}
          onFechar={() => setBaixando(false)}
          onConcluida={() => setBaixando(false)}
        />
      )}
    </>
  );
}

function Chip({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm ${ativo ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-secondary"}`}
    >
      {children}
    </button>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{rotulo}</span>
      <span>{brl(valor)}</span>
    </div>
  );
}

/** Quantidade, opções e observação de um item do cardápio. */
function EscolherItemDialog({
  item,
  grupos,
  opcoes,
  carregando,
  onConfirmar,
  onFechar,
}: {
  item: CardapioItem;
  grupos: { id: string; nome: string; obrigatorio: boolean; max_escolhas: number }[];
  opcoes: { id: string; grupo_id: string; nome: string; preco_adicional: number }[];
  carregando: boolean;
  onConfirmar: (p: { qtd: number; opcoes: string[]; obs: string }) => void;
  onFechar: () => void;
}) {
  const [qtd, setQtd] = useState("1");
  const [obs, setObs] = useState("");
  const [escolhidas, setEscolhidas] = useState<string[]>([]);

  const acrescimo = opcoes
    .filter((o) => escolhidas.includes(o.id))
    .reduce((s, o) => s + Number(o.preco_adicional), 0);
  const quantidade = Number(qtd.replace(",", ".")) || 0;

  function alternar(grupoId: string, opcaoId: string, max: number) {
    setEscolhidas((atual) => {
      if (atual.includes(opcaoId)) return atual.filter((x) => x !== opcaoId);
      if (max === 1) {
        const doGrupo = opcoes.filter((o) => o.grupo_id === grupoId).map((o) => o.id);
        return [...atual.filter((x) => !doGrupo.includes(x)), opcaoId];
      }
      return [...atual, opcaoId];
    });
  }

  function confirmar() {
    if (quantidade <= 0) {
      toast.error("Informe uma quantidade maior que zero");
      return;
    }
    const problema = validarOpcoes(grupos, opcoes, escolhidas);
    if (problema) {
      toast.error(problema);
      return;
    }
    onConfirmar({ qtd: quantidade, opcoes: escolhidas, obs: obs.trim() });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {item.nome}{" "}
            <span className="text-sm font-normal text-muted-foreground">{brl(item.preco)}</span>
          </DialogTitle>
        </DialogHeader>
        {grupos.map((g) => (
          <fieldset key={g.id} className="rounded border p-3">
            <legend className="px-1 text-sm font-medium">
              {g.nome}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {g.obrigatorio ? "obrigatório" : "opcional"}
                {g.max_escolhas > 1 ? ` · até ${g.max_escolhas}` : ""}
              </span>
            </legend>
            <div className="grid gap-1">
              {opcoes
                .filter((o) => o.grupo_id === g.id)
                .map((o) => (
                  <label key={o.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type={g.max_escolhas === 1 ? "radio" : "checkbox"}
                      name={g.id}
                      checked={escolhidas.includes(o.id)}
                      onChange={() => alternar(g.id, o.id, g.max_escolhas)}
                    />
                    <span className="flex-1">{o.nome}</span>
                    {Number(o.preco_adicional) > 0 && (
                      <span className="text-muted-foreground">+ {brl(o.preco_adicional)}</span>
                    )}
                  </label>
                ))}
            </div>
          </fieldset>
        ))}
        <div className="grid grid-cols-[6rem_1fr] gap-3">
          <div>
            <Label htmlFor="it-qtd">Quantidade</Label>
            <Input
              id="it-qtd"
              inputMode="decimal"
              value={qtd}
              onChange={(e) => setQtd(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="it-obs">Observação</Label>
            <Input
              id="it-obs"
              placeholder="ex.: sem cebola"
              value={obs}
              onChange={(e) => setObs(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Voltar
          </Button>
          <Button onClick={confirmar} disabled={carregando}>
            Lançar · {brl(quantidade * (Number(item.preco) + acrescimo))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
