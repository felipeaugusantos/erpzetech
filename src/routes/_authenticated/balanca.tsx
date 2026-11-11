import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, ScanBarcode, Scale, X } from "lucide-react";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCardapio } from "@/hooks/useCardapio";
import { useSessionData } from "@/hooks/useSessionData";
import { useTaras } from "@/hooks/useTaras";
import { useModulosCnae } from "@/lib/cnae";
import { brl } from "@/lib/format";
import { acharMesa, interpretarLeitura } from "@/lib/leitor-comanda";
import { useOnline } from "@/lib/offline";
import { calcularPesagem, kgTexto, pesoEmGramas } from "@/lib/pesagem";
import {
  CHAVE_REST,
  rpcRestaurante,
  tabela,
  type Comanda,
  type Mesa,
} from "@/lib/restaurante-dados";
import { htmlTicketPesagem } from "@/lib/ticket-pesagem";

export const Route = createFileRoute("/_authenticated/balanca")({
  head: () => ({
    meta: [
      { title: "Balança — EZRA ERP" },
      { name: "description", content: "Pesagem do prato por quilo, com tara e buffet livre." },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Balanca,
});

const PERFIS_BALANCA = ["administrador", "gestor", "garcom", "caixa"];
const campo =
  "h-12 w-full rounded-md border border-input bg-background px-3 text-base focus:outline-none focus:ring-2 focus:ring-ring";

type Resultado = {
  item_id: string;
  item: string;
  preco_kg: number;
  bruto_g: number;
  tara_g: number;
  tara_nome: string | null;
  liquido_g: number;
  valor: number;
  teto_aplicado: boolean;
};

function Balanca() {
  const qc = useQueryClient();
  const online = useOnline();
  const { data: session } = useSessionData();
  const modulos = useModulosCnae();
  const roles = session?.roles ?? [];
  const leitorRef = useRef<HTMLInputElement>(null);
  const pesoRef = useRef<HTMLInputElement>(null);

  const [leitura, setLeitura] = useState("");
  const [comanda, setComanda] = useState<Comanda | null>(null);
  const [itemId, setItemId] = useState("");
  const [taraId, setTaraId] = useState("nenhuma");
  const [peso, setPeso] = useState("");
  const [unidade, setUnidade] = useState<"g" | "kg">("g");
  const [servico, setServico] = useState("10");
  const [imprimir, setImprimir] = useState(true);
  const [ultimo, setUltimo] = useState<(Resultado & { comanda: number }) | null>(null);

  const { data: cardapio } = useCardapio();
  const { data: taras = [] } = useTaras();
  const porPeso = (cardapio?.itens ?? []).filter((i) => i.venda_por_peso);
  const item = porPeso.find((i) => i.id === itemId) ?? (porPeso.length === 1 ? porPeso[0] : null);

  const { data: config } = useQuery({
    queryKey: [CHAVE_REST, "balanca-config"],
    enabled: modulos.restaurante && online,
    queryFn: () =>
      rpcRestaurante<{ buffet_livre_ativo: boolean; buffet_livre_preco: number | null }>(
        "restaurante_balanca_config",
      ),
  });

  // a tara padrão do item vem selecionada (se ainda estiver ativa)
  useEffect(() => {
    if (!item) return;
    const padrao = taras.find((t) => t.id === item.tara_id && t.ativo);
    setTaraId(padrao ? padrao.id : "nenhuma");
  }, [item?.id, taras]); // eslint-disable-line react-hooks/exhaustive-deps

  const tara = taras.find((t) => t.id === taraId && t.ativo) ?? null;
  const brutoG = pesoEmGramas(peso, unidade);
  const previa = useMemo(
    () =>
      item && brutoG
        ? calcularPesagem({
            brutoG,
            taraG: tara?.peso_g ?? 0,
            precoKg: Number(item.preco),
            buffetLivre: config?.buffet_livre_ativo ? config.buffet_livre_preco : null,
          })
        : null,
    [item, brutoG, tara, config],
  );

  async function ler(texto: string) {
    const l = interpretarLeitura(texto);
    if (l.tipo === "vazio") return;
    setLeitura("");
    if (l.tipo === "comanda") {
      const r = await tabela("comandas").select("*").eq("numero", l.numero).maybeSingle();
      const c = r.data as unknown as Comanda | null;
      if (r.error) toast.error(r.error.message);
      else if (!c) toast.error(`Comanda ${l.numero} não encontrada`);
      else if (c.situacao !== "aberta") toast.error(`A comanda ${c.numero} já foi encerrada`);
      else setComanda(c);
    } else {
      const m = await tabela("mesas").select("*");
      const mesa = acharMesa((m.data ?? []) as unknown as Mesa[], l.numero);
      if (!mesa) {
        toast.error(`Mesa ${l.numero} não existe`);
      } else {
        const r = await tabela("comandas")
          .select("*")
          .eq("mesa_id", mesa.id)
          .eq("situacao", "aberta")
          .maybeSingle();
        const c = r.data as unknown as Comanda | null;
        if (!c) toast.error(`A mesa ${mesa.numero} não tem comanda aberta`);
        else setComanda(c);
      }
    }
    pesoRef.current?.focus();
  }

  const lancar = useMutation({
    mutationFn: async (janela: Window | null) => {
      if (!item) throw new Error("Escolha o item por peso");
      if (!brutoG) throw new Error("Informe o peso do prato");
      if (!previa) throw new Error("O peso não passa da tara");
      let alvo = comanda;
      if (!alvo) {
        // sem comanda bipada: abre uma comanda avulsa para o cliente levar o ticket ao caixa
        const id = await rpcRestaurante<string>("restaurante_abrir_comanda", {
          p_mesa_id: null,
          p_pessoas: null,
          p_cliente_nome: null,
          p_taxa_servico: Number(servico.replace(",", ".")) || 0,
          p_couvert: 0,
        });
        const r = await tabela("comandas").select("*").eq("id", id).maybeSingle();
        alvo = r.data as unknown as Comanda;
        if (!alvo) throw new Error("Não foi possível abrir a comanda");
      }
      const r = await rpcRestaurante<Resultado>("restaurante_lancar_pesagem", {
        p_comanda_id: alvo.id,
        p_cardapio_item_id: item.id,
        p_peso_bruto_g: brutoG,
        p_tara_id: tara?.id ?? null,
        p_observacao: null,
      });
      return { r, comanda: alvo, janela };
    },
    onSuccess: ({ r, comanda: c, janela }) => {
      setUltimo({ ...r, comanda: c.numero });
      toast.success(`${kgTexto(r.liquido_g)} lançados: ${brl(r.valor)}`);
      if (janela) {
        janela.document.write(
          htmlTicketPesagem({
            loja: session?.empresa?.nome_fantasia || session?.empresa?.razao_social || null,
            comanda: c.numero,
            item: r.item,
            brutoG: r.bruto_g,
            taraG: r.tara_g,
            taraNome: r.tara_nome,
            liquidoG: r.liquido_g,
            precoKg: Number(r.preco_kg),
            valor: Number(r.valor),
            tetoBuffet: r.teto_aplicado,
            emitidoEm: new Date().toLocaleString("pt-BR"),
          }),
        );
        janela.document.close();
        janela.focus();
        setTimeout(() => janela.print(), 300);
      }
      setComanda(null);
      setPeso("");
      void qc.invalidateQueries({ queryKey: [CHAVE_REST] });
      leitorRef.current?.focus();
    },
    onError: (e: Error, janela) => {
      janela?.close();
      toast.error(e.message);
    },
  });

  function confirmar() {
    // a janela de impressão precisa abrir no clique, antes das chamadas ao banco
    const janela = imprimir ? window.open("", "_blank", "width=420,height=640") : null;
    if (imprimir && !janela) toast.error("O navegador bloqueou a janela de impressão");
    lancar.mutate(janela);
  }

  if (!online)
    return (
      <>
        <PageHeader title="Balança" description="Pesagem do prato por quilo" />
        <EmptyState
          title="Sem internet"
          description="A pesagem precisa de conexão para calcular e lançar o prato. Volte quando a internet voltar."
        />
      </>
    );
  if (session && !modulos.carregando && !modulos.restaurante)
    return <ModuloBloqueado modulo="restaurante" />;
  if (session && !roles.some((r) => PERFIS_BALANCA.includes(r)))
    return (
      <EmptyState title="Sem acesso à balança" description="Seu perfil não opera a balança." />
    );

  return (
    <>
      <PageHeader
        title="Balança"
        description="Bipe a comanda do cliente (ou deixe em branco para abrir uma nova), ponha o prato e informe o peso."
      />

      {cardapio && porPeso.length === 0 && (
        <EmptyState
          title="Nenhum item vendido por peso"
          description="A gestão marca o item como “vendido por peso” em Cardápio e mesas > Itens."
        />
      )}

      {porPeso.length > 0 && (
        <div className="mx-auto grid max-w-3xl gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void ler(leitura);
              }}
              className="space-y-2"
            >
              <Label htmlFor="bal-leitor">Comanda ou mesa</Label>
              <div className="relative">
                <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="bal-leitor"
                  ref={leitorRef}
                  autoFocus
                  className="h-12 pl-10 text-base"
                  placeholder="Bipe o código C123 ou digite a mesa"
                  value={leitura}
                  onChange={(e) => setLeitura(e.target.value)}
                />
              </div>
              {comanda ? (
                <p className="flex items-center justify-between rounded border border-emerald-500 bg-emerald-50 px-3 py-2 text-sm">
                  <span>
                    Lançando na <strong>comanda {comanda.numero}</strong>
                    {comanda.cliente_nome ? ` · ${comanda.cliente_nome}` : ""}
                  </span>
                  <button
                    type="button"
                    aria-label="Tirar a comanda"
                    onClick={() => setComanda(null)}
                    className="rounded p-1 hover:bg-emerald-100"
                  >
                    <X className="size-4" />
                  </button>
                </p>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Sem comanda: abre uma nova, com serviço de</span>
                  <Input
                    aria-label="Serviço da nova comanda (%)"
                    className="h-8 w-16"
                    inputMode="decimal"
                    value={servico}
                    onChange={(e) => setServico(e.target.value)}
                  />
                  <span>%</span>
                </div>
              )}
            </form>

            {porPeso.length > 1 && (
              <div>
                <Label htmlFor="bal-item">Item</Label>
                <select
                  id="bal-item"
                  className={campo}
                  value={item?.id ?? ""}
                  onChange={(e) => setItemId(e.target.value)}
                >
                  <option value="">Escolha o item</option>
                  {porPeso.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.nome} — {brl(i.preco)}/kg
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <Label htmlFor="bal-tara">Tara (prato ou vasilhame)</Label>
              <select
                id="bal-tara"
                className={campo}
                value={taraId}
                onChange={(e) => setTaraId(e.target.value)}
              >
                <option value="nenhuma">Sem tara</option>
                {taras
                  .filter((t) => t.ativo)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome} ({t.peso_g} g)
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor="bal-peso">Peso na balança</Label>
                <Input
                  id="bal-peso"
                  ref={pesoRef}
                  className="h-14 text-2xl"
                  inputMode="decimal"
                  placeholder={unidade === "g" ? "850" : "0,850"}
                  value={peso}
                  onChange={(e) => setPeso(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && previa && !lancar.isPending) confirmar();
                  }}
                />
              </div>
              <select
                aria-label="Unidade do peso"
                className="h-14 rounded-md border border-input bg-background px-3"
                value={unidade}
                onChange={(e) => setUnidade(e.target.value as "g" | "kg")}
              >
                <option value="g">g</option>
                <option value="kg">kg</option>
              </select>
            </div>
            <p className="text-xs text-muted-foreground">
              A balança com saída de teclado preenche o peso sozinha; o Enter lança o prato.
            </p>
          </div>

          <div className="space-y-3 rounded-xl border-2 p-4">
            <div className="flex items-center gap-2 font-display text-lg font-semibold">
              <Scale className="size-5" /> {item?.nome ?? "Escolha o item"}
            </div>
            {item && <p className="text-sm text-muted-foreground">{brl(item.preco)} por kg</p>}
            {brutoG && !previa && (
              <p className="rounded bg-red-50 p-2 text-sm text-red-700">
                O peso informado não passa da tara ({tara?.peso_g ?? 0} g).
              </p>
            )}
            {previa && (
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Peso bruto</span>
                  <span>{kgTexto(brutoG!)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tara{tara ? ` (${tara.nome})` : ""}</span>
                  <span>- {kgTexto(tara?.peso_g ?? 0)}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>Peso líquido</span>
                  <span>{kgTexto(previa.liquidoG)}</span>
                </div>
                {previa.tetoAplicado && (
                  <p className="text-xs text-amber-700">
                    Pelo peso seriam {brl(previa.valorSemTeto)}: vale o preço do buffet livre.
                  </p>
                )}
                <p className="pt-2 text-center font-display text-4xl font-bold">
                  {brl(previa.valor)}
                </p>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={imprimir}
                onChange={(e) => setImprimir(e.target.checked)}
              />
              <Printer className="size-4" /> Imprimir o ticket do prato
            </label>
            <Button
              size="lg"
              className="w-full"
              disabled={!previa || !item || lancar.isPending}
              onClick={confirmar}
            >
              Lançar na comanda{comanda ? ` ${comanda.numero}` : " nova"}
            </Button>
            {ultimo && (
              <p className="rounded bg-secondary p-2 text-xs">
                Último: comanda {ultimo.comanda} · {kgTexto(ultimo.liquido_g)} · {brl(ultimo.valor)}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
