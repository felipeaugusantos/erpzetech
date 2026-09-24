import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, num } from "@/lib/format";
import { formasPagamento, hojeISO, labelForma, somaDias } from "@/lib/financeiro";
import type { FormaPagamento } from "@/lib/financeiro";
import { autorizarGestor, sugerirProdutos } from "@/lib/frente-caixa.functions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/frente-caixa")({
  head: () => ({
    meta: [
      { title: "Frente de caixa — ERP Ze Tech" },
      { name: "description", content: "Frente de caixa em tela cheia, operada pelo teclado, com caixa por operador e senha do gestor." },
      { property: "og:title", content: "Frente de caixa — ERP Ze Tech" },
      { property: "og:description", content: "Venda rápida pelo teclado com sugestão de produtos por IA." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FrenteCaixa,
});

type Linha = { produto_id: string; descricao: string; unidade: string; preco: number; quantidade: number };
type AcaoGestor = "cancelar_venda" | "desconto" | "sangria";
const rotuloAcao: Record<AcaoGestor, string> = {
  cancelar_venda: "Cancelar venda",
  desconto: "Desconto acima do limite",
  sangria: "Sangria",
};
const parseNum = (v: string) => {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 0;
};

function FrenteCaixa() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const buscaRef = useRef<HTMLInputElement>(null);
  const autorizar = useServerFn(autorizarGestor);
  const sugerir = useServerFn(sugerirProdutos);

  const [busca, setBusca] = useState("");
  const [qtd, setQtd] = useState("1");
  const [sel, setSel] = useState(0);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [desconto, setDesconto] = useState("0");
  const [forma, setForma] = useState<FormaPagamento>("dinheiro");
  const [parcelas, setParcelas] = useState("1");
  const [recebido, setRecebido] = useState("");
  const [modal, setModal] = useState<null | "pagamento" | "ia" | "desconto" | "movimento" | "vendas" | "abrir" | "fechar" | "operador">(null);
  const [gestor, setGestor] = useState<null | { acao: AcaoGestor; executar: (aut: string) => void }>(null);
  const [gEmail, setGEmail] = useState("");
  const [gSenha, setGSenha] = useState("");
  const [autDesconto, setAutDesconto] = useState<string | null>(null);
  const [textoIa, setTextoIa] = useState("");
  const [sugestoes, setSugestoes] = useState<{ itens: (Linha & { motivo: string; marcado: boolean })[]; observacao: string } | null>(null);
  const [mov, setMov] = useState({ tipo: "suprimento" as "sangria" | "suprimento", valor: "", descricao: "" });
  const [valorCaixa, setValorCaixa] = useState("");
  const [opEmail, setOpEmail] = useState("");
  const [opSenha, setOpSenha] = useState("");

  const { data: base } = useQuery({
    queryKey: ["frente-base"],
    queryFn: async () => {
      const [dep, prod, emp, cx] = await Promise.all([
        supabase.from("depositos").select("id, nome, filial_id").eq("ativo", true).order("nome"),
        supabase.from("produtos").select("id, descricao, codigo_interno, codigo_barras, unidade, unidade_venda, preco_venda").eq("ativo", true).order("descricao"),
        supabase.from("empresas").select("pdv_desconto_limite").limit(1).maybeSingle(),
        supabase.rpc("frente_caixa_atual"),
      ]);
      let caixa = null as null | { id: string; numero: number | null; valor_abertura: number };
      if (cx.data) {
        const { data } = await supabase.from("caixas").select("id, numero, valor_abertura").eq("id", cx.data as string).maybeSingle();
        caixa = data;
      }
      return {
        depositos: dep.data ?? [],
        produtos: prod.data ?? [],
        limite: Number(emp.data?.pdv_desconto_limite ?? 5),
        caixa,
      };
    },
  });
  const produtos = base?.produtos ?? [];
  const deposito = base?.depositos.find((d) => !session?.profile?.filial_id || d.filial_id === session.profile.filial_id) ?? base?.depositos[0];
  const caixa = base?.caixa ?? null;

  const { data: vendas = [] } = useQuery({
    queryKey: ["frente-vendas", caixa?.id],
    enabled: !!caixa,
    queryFn: async () => {
      const { data } = await supabase.from("pedidos").select("id, numero, total, forma_pagamento, situacao, created_at")
        .eq("caixa_id", caixa!.id).order("created_at", { ascending: false }).limit(30);
      return data ?? [];
    },
  });

  const achados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return [];
    return produtos.filter((p) => p.descricao.toLowerCase().includes(t) || (p.codigo_barras ?? "") === t || (p.codigo_interno ?? "").toLowerCase() === t).slice(0, 8);
  }, [busca, produtos]);

  const subtotal = linhas.reduce((s, l) => s + l.quantidade * l.preco, 0);
  const descNum = Math.max(Number(desconto.replace(",", ".")) || 0, 0);
  const total = Math.max(subtotal - descNum, 0);
  const limiteValor = Math.round(subtotal * (base?.limite ?? 5)) / 100;
  const troco = Math.max((Number(recebido.replace(",", ".")) || 0) - total, 0);
  const aPrazo = forma === "crediario" || forma === "boleto";

  function adicionar(p: { id: string; descricao: string; unidade: string | null; unidade_venda: string | null; preco_venda: number | null }, q: number) {
    if (q <= 0) return toast.error("Quantidade inválida");
    setLinhas((a) => {
      const e = a.find((l) => l.produto_id === p.id);
      if (e) return a.map((l) => (l.produto_id === p.id ? { ...l, quantidade: Math.round((l.quantidade + q) * 1000) / 1000 } : l));
      return [...a, { produto_id: p.id, descricao: p.descricao, unidade: p.unidade_venda ?? p.unidade ?? "UN", preco: Number(p.preco_venda ?? 0), quantidade: q }];
    });
    setBusca(""); setQtd("1"); setSel(0);
    buscaRef.current?.focus();
  }

  function onEnter() {
    const t = busca.trim();
    if (!t) return;
    // "3*789..." multiplica a quantidade
    const m = t.match(/^(\d+(?:[.,]\d+)?)\*(.+)$/);
    const q = m ? parseNum(m[1]!) : parseNum(qtd);
    const termo = (m ? m[2]! : t).toLowerCase();
    const exato = produtos.find((p) => (p.codigo_barras ?? "").toLowerCase() === termo || (p.codigo_interno ?? "").toLowerCase() === termo);
    const p = exato ?? (m ? null : achados[sel]);
    if (p) adicionar(p, q);
    else toast.error("Produto não encontrado");
  }

  function pedirGestor(acao: AcaoGestor, executar: (aut: string) => void) {
    setGEmail(""); setGSenha(""); setGestor({ acao, executar });
  }

  const confirmarGestor = useMutation({
    mutationFn: async () => autorizar({ data: { email: gEmail, senha: gSenha, acao: gestor!.acao } }),
    onSuccess: ({ autorizacaoId }) => { const g = gestor!; setGestor(null); g.executar(autorizacaoId); },
    onError: (e: Error) => toast.error(e.message),
  });

  const finalizar = useMutation({
    mutationFn: async () => {
      if (!deposito) throw new Error("Nenhum depósito ativo");
      if (!linhas.length) throw new Error("Inclua itens na venda");
      const { data, error } = await supabase.rpc("frente_venda", {
        p_deposito_id: deposito.id,
        p_itens: linhas.map((l) => ({ produto_id: l.produto_id, quantidade: l.quantidade, preco_unitario: l.preco })),
        p_forma: forma,
        p_desconto: descNum,
        p_parcelas: Math.max(Number(parcelas) || 1, 1),
        ...(aPrazo ? { p_primeiro_vencimento: somaDias(hojeISO(), 30) } : {}),
        ...(autDesconto ? { p_autorizacao: autDesconto } : {}),
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast.success(`Venda concluída${!aPrazo && troco > 0 ? ` — troco ${brl(troco)}` : ""}`);
      setLinhas([]); setDesconto("0"); setRecebido(""); setAutDesconto(null); setModal(null); setForma("dinheiro"); setParcelas("1");
      void qc.invalidateQueries({ queryKey: ["frente-vendas"] });
      setTimeout(() => buscaRef.current?.focus(), 50);
    },
    onError: (e: Error) => toast.error("Não foi possível finalizar", { description: e.message }),
  });

  const cancelarVenda = useMutation({
    mutationFn: async ({ id, aut }: { id: string; aut: string }) => {
      const { error } = await supabase.rpc("frente_cancelar_venda", { p_pedido_id: id, p_autorizacao: aut, p_motivo: "Cancelada no caixa" });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Venda cancelada, estoque devolvido"); void qc.invalidateQueries({ queryKey: ["frente-vendas"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const movimentar = useMutation({
    mutationFn: async (aut: string | null) => {
      const valor = Number(mov.valor.replace(",", ".")) || 0;
      if (valor <= 0) throw new Error("Informe o valor");
      const { error } = await supabase.rpc("frente_movimento", {
        p_tipo: mov.tipo, p_valor: valor, p_descricao: mov.descricao || (mov.tipo === "sangria" ? "Sangria" : "Suprimento"),
        ...(aut ? { p_autorizacao: aut } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Movimento registrado"); setModal(null); setMov({ tipo: "suprimento", valor: "", descricao: "" }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const abrirCaixa = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("frente_abrir_caixa", {
        p_filial_id: deposito?.filial_id ?? session?.profile?.filial_id ?? (null as unknown as string),
        p_valor_abertura: Number(valorCaixa.replace(",", ".")) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Caixa aberto"); setModal(null); setValorCaixa(""); void qc.invalidateQueries({ queryKey: ["frente-base"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const fecharCaixa = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("fechar_caixa", { p_caixa_id: caixa!.id, p_valor_informado: Number(valorCaixa.replace(",", ".")) || 0 });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Caixa fechado"); setModal(null); setValorCaixa(""); void qc.invalidateQueries({ queryKey: ["frente-base"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const trocarOperador = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signInWithPassword({ email: opEmail, password: opSenha });
      if (error) throw new Error("E-mail ou senha incorretos");
    },
    onSuccess: () => { setModal(null); setOpSenha(""); setLinhas([]); void qc.invalidateQueries(); toast.success("Operador conectado"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const consultarIa = useMutation({
    mutationFn: async () => sugerir({ data: { texto: textoIa } }),
    onSuccess: (r) => {
      setSugestoes({
        observacao: r.observacao,
        itens: r.itens.map((i) => {
          const p = produtos.find((x) => x.id === i.produto_id);
          return { produto_id: i.produto_id, descricao: i.descricao, quantidade: i.quantidade, motivo: i.motivo, marcado: true,
            unidade: p?.unidade_venda ?? p?.unidade ?? "UN", preco: Number(p?.preco_venda ?? 0) };
        }),
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function aplicarDesconto(valor: string) {
    const v = Math.max(Number(valor.replace(",", ".")) || 0, 0);
    if (v > limiteValor) {
      pedirGestor("desconto", (aut) => { setAutDesconto(aut); setDesconto(valor); setModal(null); toast.success("Desconto autorizado"); });
    } else { setAutDesconto(null); setDesconto(valor); setModal(null); }
  }

  const [descTexto, setDescTexto] = useState("");

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === "Escape") { if (gestor) setGestor(null); else setModal(null); return; }
      if (gestor) return;
      if (k === "F10" && modal === "pagamento") { e.preventDefault(); finalizar.mutate(); return; }
      if (modal) return;
      const mapa: Record<string, () => void> = {
        F2: () => buscaRef.current?.focus(),
        F3: () => { setSugestoes(null); setModal("ia"); },
        F4: () => { if (!linhas.length) toast.error("Carrinho vazio"); else setModal("pagamento"); },
        F6: () => { setDescTexto(desconto); setModal("desconto"); },
        F7: () => setModal("vendas"),
        F8: () => setLinhas((a) => a.slice(0, -1)),
        F9: () => setModal("movimento"),
      };
      if (mapa[k]) { e.preventDefault(); mapa[k](); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  useEffect(() => { buscaRef.current?.focus(); }, [caixa?.id]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      <header className="flex items-center justify-between gap-3 border-b bg-sidebar px-4 py-2 text-sidebar-foreground">
        <div className="font-display text-lg font-semibold">Frente de caixa</div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>Operador: <b>{session?.profile?.nome ?? session?.user.email}</b></span>
          <span>{caixa ? `Caixa nº ${caixa.numero ?? "—"} aberto` : "Caixa fechado"}</span>
          <span>{deposito?.nome}</span>
          <Button size="sm" variant="secondary" onClick={() => setModal("operador")}>Trocar operador</Button>
          {caixa ? (
            <Button size="sm" variant="secondary" onClick={() => setModal("fechar")}>Fechar caixa</Button>
          ) : (
            <Button size="sm" onClick={() => setModal("abrir")}>Abrir caixa</Button>
          )}
          <Button size="sm" variant="ghost" asChild><Link to="/dashboard"><X className="size-4" /> Sair</Link></Button>
        </div>
      </header>

      {!caixa ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="text-lg">Abra o seu caixa para começar a vender.</p>
          <Button onClick={() => setModal("abrir")}>Abrir caixa</Button>
        </div>
      ) : (
        <div className="grid flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[1fr_360px]">
          <div className="flex min-h-0 flex-col gap-3">
            <div className="flex gap-2">
              <Input className="w-24 text-lg" value={qtd} onChange={(e) => setQtd(e.target.value)} aria-label="Quantidade" />
              <div className="relative flex-1">
                <Input ref={buscaRef} className="h-12 text-lg" placeholder="F2 — código de barras, código ou nome (ex.: 3*7891234)"
                  value={busca} onChange={(e) => { setBusca(e.target.value); setSel(0); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); onEnter(); }
                    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, achados.length - 1)); }
                    if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
                  }} />
                {achados.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow">
                    {achados.map((p, i) => (
                      <button key={p.id} type="button" onClick={() => adicionar(p, parseNum(qtd))}
                        className={`flex w-full justify-between px-3 py-2 text-left text-sm ${i === sel ? "bg-accent/30" : ""}`}>
                        <span>{p.descricao}</span><span className="text-numeric">{brl(p.preco_venda)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button variant="outline" className="h-12" onClick={() => { setSugestoes(null); setModal("ia"); }}>
                <Sparkles className="size-4" /> F3 IA
              </Button>
            </div>

            <div className="panel min-h-0 flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left">
                  <tr><th className="p-2">#</th><th className="p-2">Produto</th><th className="p-2 text-right">Qtd</th><th className="p-2 text-right">Preço</th><th className="p-2 text-right">Total</th><th /></tr>
                </thead>
                <tbody>
                  {linhas.map((l, i) => (
                    <tr key={l.produto_id} className="border-t">
                      <td className="p-2">{i + 1}</td>
                      <td className="p-2">{l.descricao}</td>
                      <td className="p-2 text-right text-numeric">{num(l.quantidade, 3)} {l.unidade}</td>
                      <td className="p-2 text-right text-numeric">{brl(l.preco)}</td>
                      <td className="p-2 text-right text-numeric font-semibold">{brl(l.quantidade * l.preco)}</td>
                      <td className="p-2"><Button size="sm" variant="ghost" onClick={() => setLinhas((a) => a.filter((x) => x.produto_id !== l.produto_id))}><X className="size-4" /></Button></td>
                    </tr>
                  ))}
                  {!linhas.length && <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">Passe o código de barras ou digite o produto.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="flex flex-col gap-3">
            <div className="panel space-y-1 p-4">
              <div className="flex justify-between text-sm"><span>Subtotal</span><span className="text-numeric">{brl(subtotal)}</span></div>
              <div className="flex justify-between text-sm"><span>Desconto {autDesconto && "(autorizado)"}</span><span className="text-numeric">{brl(descNum)}</span></div>
              <div className="flex justify-between pt-2 font-display text-3xl font-bold text-primary"><span>Total</span><span className="text-numeric">{brl(total)}</span></div>
            </div>
            <div className="panel grid grid-cols-2 gap-1 p-3 text-xs">
              {[["F2", "Buscar produto"], ["Enter", "Adicionar item"], ["F3", "Sugestão por IA"], ["F4", "Pagamento"], ["F6", "Desconto"], ["F7", "Vendas / cancelar"], ["F8", "Remover último item"], ["F9", "Sangria / suprimento"], ["F10", "Finalizar (no pagamento)"], ["Esc", "Fechar janela"]].map(([k, t]) => (
                <div key={k} className="flex gap-2"><kbd className="rounded border bg-muted px-1.5 font-mono">{k}</kbd><span>{t}</span></div>
              ))}
            </div>
            <Button size="lg" className="h-14 text-lg" disabled={!linhas.length} onClick={() => setModal("pagamento")}>F4 — Pagamento</Button>
          </aside>
        </div>
      )}

      {/* Pagamento */}
      <Dialog open={modal === "pagamento"} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Pagamento — {brl(total)}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {formasPagamento.map((f, i) => (
              <Button key={f.value} variant={forma === f.value ? "default" : "outline"} onClick={() => setForma(f.value)}>{i + 1}. {f.label}</Button>
            ))}
          </div>
          {aPrazo ? (
            <div><Label>Parcelas</Label><Input value={parcelas} onChange={(e) => setParcelas(e.target.value)} /></div>
          ) : (
            <div>
              <Label>Valor recebido</Label>
              <Input autoFocus className="text-lg" value={recebido} onChange={(e) => setRecebido(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") finalizar.mutate(); }} />
              <p className="mt-2 font-display text-2xl font-bold">Troco: {brl(troco)}</p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => finalizar.mutate()} disabled={finalizar.isPending}>F10 — Finalizar venda</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Desconto */}
      <Dialog open={modal === "desconto"} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Desconto na venda</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Até {brl(limiteValor)} ({num(base?.limite ?? 5)}%) sem senha. Acima disso, pede a senha do gestor.</p>
          <Input autoFocus value={descTexto} onChange={(e) => setDescTexto(e.target.value)} onKeyDown={(e) => e.key === "Enter" && aplicarDesconto(descTexto)} />
          <DialogFooter><Button onClick={() => aplicarDesconto(descTexto)}>Aplicar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* IA */}
      <Dialog open={modal === "ia"} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>O que o cliente procura?</DialogTitle></DialogHeader>
          <Textarea autoFocus rows={3} placeholder="Ex.: quero rebocar uma parede de 3 por 4 metros" value={textoIa} onChange={(e) => setTextoIa(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) consultarIa.mutate(); }} />
          <Button onClick={() => consultarIa.mutate()} disabled={consultarIa.isPending || textoIa.trim().length < 3}>
            <Sparkles className="size-4" /> {consultarIa.isPending ? "Procurando produtos..." : "Sugerir produtos (Ctrl+Enter)"}
          </Button>
          {sugestoes && (
            <div className="space-y-2">
              {sugestoes.itens.length === 0 && <p className="text-sm text-muted-foreground">Nenhum produto correspondente no catálogo.</p>}
              {sugestoes.itens.map((s, i) => (
                <label key={s.produto_id} className="flex items-start gap-2 rounded border p-2 text-sm">
                  <input type="checkbox" checked={s.marcado} onChange={(e) => setSugestoes({ ...sugestoes, itens: sugestoes.itens.map((x, j) => (j === i ? { ...x, marcado: e.target.checked } : x)) })} />
                  <div className="flex-1"><b>{s.descricao}</b> — {brl(s.preco)}<p className="text-xs text-muted-foreground">{s.motivo}</p></div>
                  <Input className="w-24" defaultValue={String(s.quantidade).replace(".", ",")}
                    onChange={(e) => setSugestoes({ ...sugestoes, itens: sugestoes.itens.map((x, j) => (j === i ? { ...x, quantidade: parseNum(e.target.value) } : x)) })} />
                  <span className="pt-2 text-xs">{s.unidade}</span>
                </label>
              ))}
              {sugestoes.observacao && <p className="text-xs text-muted-foreground">{sugestoes.observacao}</p>}
            </div>
          )}
          {sugestoes && sugestoes.itens.length > 0 && (
            <DialogFooter>
              <Button onClick={() => {
                for (const s of sugestoes.itens.filter((x) => x.marcado && x.quantidade > 0)) {
                  const p = produtos.find((x) => x.id === s.produto_id);
                  if (p) adicionar(p, s.quantidade);
                }
                setModal(null); setTextoIa("");
              }}>Adicionar selecionados à venda</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Sangria / suprimento */}
      <Dialog open={modal === "movimento"} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Sangria ou suprimento</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <Button variant={mov.tipo === "suprimento" ? "default" : "outline"} onClick={() => setMov({ ...mov, tipo: "suprimento" })}>Suprimento</Button>
            <Button variant={mov.tipo === "sangria" ? "default" : "outline"} onClick={() => setMov({ ...mov, tipo: "sangria" })}>Sangria (senha do gestor)</Button>
          </div>
          <div><Label>Valor</Label><Input autoFocus value={mov.valor} onChange={(e) => setMov({ ...mov, valor: e.target.value })} /></div>
          <div><Label>Descrição</Label><Input value={mov.descricao} onChange={(e) => setMov({ ...mov, descricao: e.target.value })} /></div>
          <DialogFooter>
            <Button onClick={() => (mov.tipo === "sangria" ? pedirGestor("sangria", (aut) => movimentar.mutate(aut)) : movimentar.mutate(null))}>Registrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vendas do caixa */}
      <Dialog open={modal === "vendas"} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Vendas deste caixa</DialogTitle></DialogHeader>
          <div className="max-h-96 space-y-1 overflow-auto">
            {vendas.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma venda ainda.</p>}
            {vendas.map((v) => (
              <div key={v.id} className="flex items-center justify-between rounded border p-2 text-sm">
                <span>Nº {v.numero} · {labelForma(v.forma_pagamento)} · {brl(v.total)}</span>
                {v.situacao === "cancelado" ? <span className="text-destructive">Cancelada</span> : (
                  <Button size="sm" variant="outline" onClick={() => pedirGestor("cancelar_venda", (aut) => cancelarVenda.mutate({ id: v.id, aut }))}>Cancelar</Button>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Abrir / fechar caixa */}
      <Dialog open={modal === "abrir" || modal === "fechar"} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{modal === "abrir" ? "Abrir caixa" : "Fechar caixa"}</DialogTitle></DialogHeader>
          <Label>{modal === "abrir" ? "Valor de abertura (troco)" : "Dinheiro contado na gaveta"}</Label>
          <Input autoFocus value={valorCaixa} onChange={(e) => setValorCaixa(e.target.value)} />
          <DialogFooter>
            <Button onClick={() => (modal === "abrir" ? abrirCaixa.mutate() : fecharCaixa.mutate())}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Trocar operador */}
      <Dialog open={modal === "operador"} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Entrar como outro operador</DialogTitle></DialogHeader>
          <div><Label>E-mail</Label><Input autoFocus value={opEmail} onChange={(e) => setOpEmail(e.target.value)} /></div>
          <div><Label>Senha</Label><Input type="password" value={opSenha} onChange={(e) => setOpSenha(e.target.value)} onKeyDown={(e) => e.key === "Enter" && trocarOperador.mutate()} /></div>
          <DialogFooter><Button onClick={() => trocarOperador.mutate()}>Entrar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Senha do gestor */}
      <Dialog open={!!gestor} onOpenChange={(o) => !o && setGestor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Senha do gestor — {gestor && rotuloAcao[gestor.acao]}</DialogTitle></DialogHeader>
          <div><Label>E-mail do gestor</Label><Input autoFocus value={gEmail} onChange={(e) => setGEmail(e.target.value)} /></div>
          <div><Label>Senha</Label><Input type="password" value={gSenha} onChange={(e) => setGSenha(e.target.value)} onKeyDown={(e) => e.key === "Enter" && confirmarGestor.mutate()} /></div>
          <DialogFooter><Button onClick={() => confirmarGestor.mutate()} disabled={confirmarGestor.isPending}>Autorizar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
