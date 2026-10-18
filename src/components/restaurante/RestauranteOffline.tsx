import { useEffect, useMemo, useState } from "react";
import { CloudOff, Minus, Plus, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

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
import { brl } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { useOnline } from "@/lib/offline";
import {
  EVENTO_COMANDAS_OFFLINE,
  lerBaseRestauranteOffline,
  lerComandasOffline,
  salvarComandasOffline,
  subtotalOffline,
  totalOffline,
  prepararReenvio,
  sincronizarComandasOffline,
  type ComandaOffline,
} from "@/lib/offline-restaurante";

const FORMAS = [
  { v: "dinheiro", l: "Dinheiro" },
  { v: "pix", l: "Pix" },
  { v: "cartao_debito", l: "Cartão de débito" },
  { v: "cartao_credito", l: "Cartão de crédito" },
];

const sel =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/** Hook: lista de comandas guardadas sem internet, atualizada em todas as telas. */
export function useComandasOffline() {
  const [lista, setLista] = useState<ComandaOffline[]>([]);
  useEffect(() => {
    const ler = () => setLista(lerComandasOffline());
    ler();
    window.addEventListener(EVENTO_COMANDAS_OFFLINE, ler);
    window.addEventListener("storage", ler);
    return () => {
      window.removeEventListener(EVENTO_COMANDAS_OFFLINE, ler);
      window.removeEventListener("storage", ler);
    };
  }, []);
  return lista;
}

/** Salão e delivery sem internet: abre, lança itens e fecha a conta, tudo guardado neste computador. */
export function RestauranteOffline({
  modo,
  pendencias = false,
}: {
  modo: "salao" | "delivery";
  pendencias?: boolean;
}) {
  const online = useOnline();
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const podeReceber = (session?.roles ?? []).some((r) =>
    ["administrador", "gestor", "caixa"].includes(r),
  );
  const todas = useComandasOffline();
  const lista = todas.filter((c) => c.tipo === modo);
  const [base] = useState(() => lerBaseRestauranteOffline());
  const [nova, setNova] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [fechando, setFechando] = useState<string | null>(null);
  const [reenvio, setReenvio] = useState<ComandaOffline | null>(null);
  const [caixasAtuais, setCaixasAtuais] = useState<{ id: string; numero: number }[]>([]);
  const [caixaReenvio, setCaixaReenvio] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function preparar(c: ComandaOffline) {
    setOcupado(true);
    try {
      const { data, error } = await supabase
        .from("caixas")
        .select("id, numero")
        .eq("situacao", "aberto");
      if (error) throw error;
      const caixas = (data ?? []).map((x) => ({ id: x.id, numero: x.numero ?? 0 }));
      setCaixasAtuais(caixas);
      setCaixaReenvio(
        caixas.some((x) => x.id === c.fechar?.caixa_id) ? (c.fechar?.caixa_id ?? "") : "",
      );
      setReenvio(c);
    } catch {
      toast.error("Não foi possível consultar os caixas. A comanda continua guardada.");
    } finally {
      setOcupado(false);
    }
  }

  async function reenviar() {
    if (!reenvio || (reenvio.fechar && (!podeReceber || !caixaReenvio))) return;
    setOcupado(true);
    try {
      atualizar(reenvio.offline_id, (c) => prepararReenvio(c, caixaReenvio || undefined));
      const resultado = await sincronizarComandasOffline();
      void qc.invalidateQueries();
      const restante = lerComandasOffline().find((c) => c.offline_id === reenvio.offline_id);
      if (restante)
        toast.error(
          restante.erro ??
            "Comanda ainda guardada. Tente novamente quando a conexão estiver disponível.",
        );
      else toast.success("Comanda enviada ao sistema; pagamento registrado no caixa.");
      if (resultado.enviadas || !restante) setReenvio(null);
    } catch {
      toast.error("Não foi possível enviar. A comanda continua guardada.");
    } finally {
      setOcupado(false);
    }
  }

  const ocupadas = new Set(lista.filter((c) => !c.fechar && c.mesa_id).map((c) => c.mesa_id));

  function atualizar(id: string, f: (c: ComandaOffline) => ComandaOffline) {
    salvarComandasOffline(lerComandasOffline().map((c) => (c.offline_id === id ? f(c) : c)));
  }

  if (pendencias && lista.length === 0) return null;

  if (!base && !pendencias)
    return (
      <div className="panel p-6 text-sm">
        <p className="font-semibold">Sem internet e sem cópia do cardápio neste computador.</p>
        <p className="mt-1 text-muted-foreground">
          Abra esta tela uma vez com internet para o sistema guardar mesas, cardápio e caixas.
        </p>
      </div>
    );

  const atual = lista.find((c) => c.offline_id === editando) ?? null;
  const aFechar = lista.find((c) => c.offline_id === fechando) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
        <CloudOff className="size-5 shrink-0" />
        <div className="flex-1 text-sm">
          <p className="font-semibold">
            {pendencias
              ? "Comandas guardadas neste computador"
              : "Sem internet — trabalhando neste computador"}
          </p>
          <p className="text-muted-foreground">
            {modo === "salao" ? "Comandas" : "Pedidos"} e pagamentos ficam salvos aqui e são
            enviados sozinhos quando a conexão voltar. Não limpe os dados do navegador.
          </p>
        </div>
        {!pendencias && (
          <Button onClick={() => setNova(true)}>
            <Plus className="mr-1 size-4" /> {modo === "salao" ? "Nova comanda" : "Novo delivery"}
          </Button>
        )}
      </div>

      {lista.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma comanda feita sem internet ainda.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {lista.map((c) => (
          <div key={c.offline_id} className="panel space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-display text-lg font-bold">
                  {c.tipo === "delivery"
                    ? c.delivery?.cliente
                    : c.mesa_rotulo
                      ? `Mesa ${c.mesa_rotulo}`
                      : c.cliente_nome || "Comanda avulsa"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(c.criada_em).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {c.itens.reduce((s, i) => s + i.quantidade, 0)} item(ns)
                </p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  c.erro
                    ? "bg-destructive/15 text-destructive"
                    : c.fechar
                      ? "bg-primary/15 text-primary"
                      : "bg-secondary"
                }`}
              >
                {c.erro ? "Recusada" : c.fechar ? "Paga · a enviar" : "Aberta"}
              </span>
            </div>
            <p className="font-display text-xl font-extrabold">
              {brl(totalOffline(c, c.fechar?.cobrar_servico ?? true))}
            </p>
            {c.erro && <p className="text-xs text-destructive">{c.erro}</p>}
            {!c.fechar && !pendencias && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditando(c.offline_id)}>
                  Itens
                </Button>
                <Button
                  size="sm"
                  disabled={c.itens.length === 0}
                  onClick={() => setFechando(c.offline_id)}
                >
                  Fechar conta
                </Button>
              </div>
            )}
            {(c.erro || (pendencias && c.fechar)) && (
              <Button
                size="sm"
                variant="outline"
                disabled={!online || ocupado || (!!c.fechar && !podeReceber)}
                onClick={() => void preparar(c)}
              >
                <RefreshCw className="mr-1 size-4" /> Tentar de novo
              </Button>
            )}
            {c.fechar && c.erro && !podeReceber && (
              <p className="text-xs text-muted-foreground">
                Peça ao caixa ou à gestão para corrigir e reenviar.
              </p>
            )}
          </div>
        ))}
      </div>

      {base && (
        <NovaComanda
          modo={modo}
          aberto={nova}
          mesas={base.mesas.filter((m) => !ocupadas.has(m.id))}
          taxaServico={base.taxaServico}
          onFechar={() => setNova(false)}
          onCriada={(c) => {
            salvarComandasOffline([...lerComandasOffline(), c]);
            setNova(false);
            setEditando(c.offline_id);
          }}
        />
      )}

      {atual && base && (
        <ItensDialog
          comanda={atual}
          cardapio={base.itens}
          onFechar={() => setEditando(null)}
          onMudar={(itens) => atualizar(atual.offline_id, (c) => ({ ...c, itens }))}
        />
      )}

      {aFechar && base && (
        <FecharDialog
          comanda={aFechar}
          caixas={base.caixas}
          onFechar={() => setFechando(null)}
          onPagar={(fechar) => {
            atualizar(aFechar.offline_id, (c) => ({ ...c, fechar }));
            setFechando(null);
            toast.success(
              "Conta fechada e guardada. Será enviada ao caixa quando a internet voltar.",
            );
          }}
        />
      )}
      {reenvio && (
        <Dialog open onOpenChange={(o) => !o && !ocupado && setReenvio(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reenviar comanda guardada</DialogTitle>
            </DialogHeader>
            {reenvio.erro && <p className="text-sm text-destructive">{reenvio.erro}</p>}
            <p className="text-sm">Itens e pagamentos recebidos serão mantidos.</p>
            {reenvio.fechar && (
              <>
                <p className="font-semibold">
                  Recebido: {brl(reenvio.fechar.pagamentos.reduce((s, p) => s + p.valor, 0))}
                </p>
                <Label htmlFor="caixa-reenvio">Caixa que recebe</Label>
                <select
                  id="caixa-reenvio"
                  className={sel}
                  value={caixaReenvio}
                  onChange={(e) => setCaixaReenvio(e.target.value)}
                  disabled={ocupado}
                >
                  <option value="">
                    {caixasAtuais.length ? "Selecione um caixa aberto" : "Nenhum caixa aberto"}
                  </option>
                  {caixasAtuais.map((c) => (
                    <option key={c.id} value={c.id}>
                      Caixa {c.numero}
                    </option>
                  ))}
                </select>
              </>
            )}
            <DialogFooter>
              <Button variant="outline" disabled={ocupado} onClick={() => setReenvio(null)}>
                Voltar
              </Button>
              <Button
                disabled={
                  !online || ocupado || (!!reenvio.fechar && (!podeReceber || !caixaReenvio))
                }
                onClick={() => void reenviar()}
              >
                <RefreshCw className="mr-1 size-4" /> {ocupado ? "Enviando…" : "Reenviar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function NovaComanda({
  modo,
  aberto,
  mesas,
  taxaServico,
  onFechar,
  onCriada,
}: {
  modo: "salao" | "delivery";
  aberto: boolean;
  mesas: { id: string; numero: string }[];
  taxaServico: number;
  onFechar: () => void;
  onCriada: (c: ComandaOffline) => void;
}) {
  const [mesa, setMesa] = useState("");
  const [cliente, setCliente] = useState("");
  const [pessoas, setPessoas] = useState("");
  const [telefone, setTelefone] = useState("");
  const [endereco, setEndereco] = useState("");
  const [bairro, setBairro] = useState("");
  const [taxa, setTaxa] = useState("0");
  const [pagamento, setPagamento] = useState("dinheiro");

  function criar() {
    if (modo === "delivery" && (cliente.trim().length < 2 || endereco.trim().length < 5)) {
      toast.error("Informe o nome do cliente e o endereço");
      return;
    }
    const m = mesas.find((x) => x.id === mesa);
    onCriada({
      offline_id: crypto.randomUUID(),
      criada_em: new Date().toISOString(),
      tipo: modo,
      mesa_id: m?.id ?? null,
      mesa_rotulo: m?.numero ?? null,
      cliente_nome: cliente.trim() || null,
      pessoas: pessoas ? Number(pessoas) : null,
      taxa_servico: modo === "salao" ? taxaServico : 0,
      delivery:
        modo === "delivery"
          ? {
              cliente: cliente.trim(),
              telefone: telefone.trim(),
              endereco: endereco.trim(),
              bairro: bairro.trim(),
              taxa: Number(taxa.replace(",", ".")) || 0,
              pagamento,
            }
          : null,
      itens: [],
      fechar: null,
    });
    setMesa("");
    setCliente("");
    setPessoas("");
    setTelefone("");
    setEndereco("");
    setBairro("");
    setTaxa("0");
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {modo === "salao" ? "Nova comanda" : "Novo delivery"} (sem internet)
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {modo === "salao" ? (
            <>
              <div>
                <Label>Mesa</Label>
                <select className={sel} value={mesa} onChange={(e) => setMesa(e.target.value)}>
                  <option value="">Comanda avulsa (sem mesa)</option>
                  {mesas.map((m) => (
                    <option key={m.id} value={m.id}>
                      Mesa {m.numero}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Cliente (opcional)</Label>
                  <Input value={cliente} onChange={(e) => setCliente(e.target.value)} />
                </div>
                <div>
                  <Label>Pessoas</Label>
                  <Input
                    inputMode="numeric"
                    value={pessoas}
                    onChange={(e) => setPessoas(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Cliente</Label>
                  <Input value={cliente} onChange={(e) => setCliente(e.target.value)} />
                </div>
                <div>
                  <Label>Telefone</Label>
                  <Input value={telefone} onChange={(e) => setTelefone(e.target.value)} />
                </div>
              </div>
              <div>
                <Label>Endereço</Label>
                <Input value={endereco} onChange={(e) => setEndereco(e.target.value)} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Bairro</Label>
                  <Input value={bairro} onChange={(e) => setBairro(e.target.value)} />
                </div>
                <div>
                  <Label>Taxa de entrega</Label>
                  <Input
                    inputMode="decimal"
                    value={taxa}
                    onChange={(e) => setTaxa(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Pagamento</Label>
                  <select
                    className={sel}
                    value={pagamento}
                    onChange={(e) => setPagamento(e.target.value)}
                  >
                    {FORMAS.map((f) => (
                      <option key={f.v} value={f.v}>
                        {f.l}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Voltar
          </Button>
          <Button onClick={criar}>Abrir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ItensDialog({
  comanda,
  cardapio,
  onFechar,
  onMudar,
}: {
  comanda: ComandaOffline;
  cardapio: { id: string; nome: string; preco: number }[];
  onFechar: () => void;
  onMudar: (itens: ComandaOffline["itens"]) => void;
}) {
  const [busca, setBusca] = useState("");
  const filtrados = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return b ? cardapio.filter((i) => i.nome.toLowerCase().includes(b)) : cardapio;
  }, [busca, cardapio]);

  function somar(id: string, nome: string, preco: number, delta: number) {
    const itens = [...comanda.itens];
    const i = itens.findIndex((x) => x.cardapio_item_id === id);
    if (i < 0 && delta > 0) itens.push({ cardapio_item_id: id, nome, preco, quantidade: 1 });
    else if (i >= 0) {
      const q = itens[i]!.quantidade + delta;
      if (q <= 0) itens.splice(i, 1);
      else itens[i] = { ...itens[i]!, quantidade: q };
    }
    onMudar(itens);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Itens da comanda</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Input
              autoFocus
              placeholder="Buscar no cardápio"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {filtrados.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-secondary"
                    onClick={() => somar(i.id, i.nome, i.preco, 1)}
                  >
                    <span>{i.nome}</span>
                    <span className="font-medium">{brl(i.preco)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold">Na comanda</p>
            <ul className="mt-2 space-y-2">
              {comanda.itens.map((i) => (
                <li key={i.cardapio_item_id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1">{i.nome}</span>
                  <Button
                    size="icon"
                    variant="outline"
                    className="size-7"
                    onClick={() => somar(i.cardapio_item_id, i.nome, i.preco, -1)}
                  >
                    {i.quantidade === 1 ? (
                      <Trash2 className="size-3.5" />
                    ) : (
                      <Minus className="size-3.5" />
                    )}
                  </Button>
                  <span className="w-6 text-center">{i.quantidade}</span>
                  <Button
                    size="icon"
                    variant="outline"
                    className="size-7"
                    onClick={() => somar(i.cardapio_item_id, i.nome, i.preco, 1)}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                  <span className="w-20 text-right">{brl(i.preco * i.quantidade)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-right text-sm">
              Itens: <strong>{brl(subtotalOffline(comanda))}</strong>
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onFechar}>Pronto</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FecharDialog({
  comanda,
  caixas,
  onFechar,
  onPagar,
}: {
  comanda: ComandaOffline;
  caixas: { id: string; numero: number }[];
  onFechar: () => void;
  onPagar: (f: NonNullable<ComandaOffline["fechar"]>) => void;
}) {
  const [servico, setServico] = useState(true);
  const [forma, setForma] = useState(comanda.delivery?.pagamento || "dinheiro");
  const [caixa, setCaixa] = useState(caixas[0]?.id ?? "");
  const total = totalOffline(comanda, servico);

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fechar a conta (sem internet)</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {comanda.tipo === "salao" && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={servico}
                onChange={(e) => setServico(e.target.checked)}
              />
              Cobrar serviço de {comanda.taxa_servico}%
            </label>
          )}
          <p className="font-display text-3xl font-extrabold">{brl(total)}</p>
          <div>
            <Label>Forma de pagamento</Label>
            <select className={sel} value={forma} onChange={(e) => setForma(e.target.value)}>
              {FORMAS.map((f) => (
                <option key={f.v} value={f.v}>
                  {f.l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Caixa que recebe</Label>
            <select className={sel} value={caixa} onChange={(e) => setCaixa(e.target.value)}>
              {caixas.length === 0 && (
                <option value="">Nenhum caixa aberto na última conexão</option>
              )}
              {caixas.map((c) => (
                <option key={c.id} value={c.id}>
                  Caixa {c.numero}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Voltar
          </Button>
          <Button
            disabled={!caixa}
            onClick={() =>
              onPagar({
                pagamentos: [{ forma, valor: total }],
                caixa_id: caixa,
                cobrar_servico: servico,
              })
            }
          >
            Receber {brl(total)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
