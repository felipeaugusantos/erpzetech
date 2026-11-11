import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, ImagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { ChamadosAdmin } from "@/components/restaurante/ChamadosAdmin";
import { CardapiosAdmin } from "@/components/restaurante/CardapiosAdmin";
import { EstoqueRestaurante } from "@/components/restaurante/EstoqueRestaurante";
import { FichaEditor } from "@/components/restaurante/FichaEditor";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCardapio } from "@/hooks/useCardapio";
import { usePracas } from "@/hooks/usePracas";
import { useTaras } from "@/hooks/useTaras";
import { useZonasEntrega } from "@/hooks/useZonasEntrega";
import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { useModulosCnae } from "@/lib/cnae";
import { brl } from "@/lib/format";
import { ehGestaoSalao, rotuloEstacao } from "@/lib/restaurante";
import {
  CHAVE_REST,
  rpcRestaurante,
  tabela,
  type CardapioCategoria,
  type CardapioGrupo,
  type CardapioItem,
  type CardapioOpcao,
  type Mesa,
} from "@/lib/restaurante-dados";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";

import { apagarFotoCardapio, enviarFotoCardapio, urlFotoCardapio } from "@/lib/cardapio-foto";

export const Route = createFileRoute("/_authenticated/cardapio")({
  head: () => ({
    meta: [
      { title: "Cardápio e mesas — EZRA ERP" },
      { name: "description", content: "Cadastro do cardápio, das opções dos pratos e das mesas." },
    ],
  }),
  component: Cardapio,
});

const dinheiro = (v: string) => Number(v.replace(",", ".")) || 0;
const textoNumero = (n: number | null | undefined) =>
  n == null ? "" : String(n).replace(".", ",");

function Cardapio() {
  const { data: session } = useSessionData();
  const modulos = useModulosCnae();
  const roles = session?.roles ?? [];

  if (session && !modulos.carregando && !modulos.restaurante)
    return <ModuloBloqueado modulo="restaurante" />;
  if (session && !ehGestaoSalao(roles))
    return (
      <EmptyState
        title="Só a gestão cadastra o cardápio"
        description="Peça a um administrador ou gestor para alterar itens, preços e mesas."
      />
    );

  return (
    <>
      <PageHeader
        title="Cardápio e mesas"
        description="Itens, preços, opções dos pratos (ponto da carne, adicionais) e as mesas do salão."
      />
      <Tabs defaultValue="itens">
        <TabsList>
          <TabsTrigger value="itens">Itens</TabsTrigger>
          <TabsTrigger value="cardapios">Cardápios</TabsTrigger>
          <TabsTrigger value="categorias">Categorias</TabsTrigger>
          <TabsTrigger value="mesas">Mesas</TabsTrigger>
          <TabsTrigger value="pracas">Praças de produção</TabsTrigger>
          <TabsTrigger value="estoque">Estoque e custos</TabsTrigger>
          <TabsTrigger value="delivery">Delivery</TabsTrigger>
          <TabsTrigger value="balanca">Balança e tara</TabsTrigger>
          <TabsTrigger value="chamados">Chamar garçom</TabsTrigger>
          <TabsTrigger value="online">Cardápio online</TabsTrigger>
        </TabsList>
        <TabsContent value="itens">
          <Itens tenantId={session?.profile?.tenant_id ?? ""} />
        </TabsContent>
        <TabsContent value="cardapios">
          <CardapiosAdmin tenantId={session?.profile?.tenant_id ?? ""} />
        </TabsContent>
        <TabsContent value="categorias">
          <Categorias tenantId={session?.profile?.tenant_id ?? ""} />
        </TabsContent>
        <TabsContent value="mesas">
          <Mesas tenantId={session?.profile?.tenant_id ?? ""} />
        </TabsContent>
        <TabsContent value="pracas">
          <Pracas tenantId={session?.profile?.tenant_id ?? ""} />
        </TabsContent>
        <TabsContent value="estoque">
          <EstoqueRestaurante tenantId={session?.profile?.tenant_id ?? ""} />
        </TabsContent>
        <TabsContent value="balanca">
          <Balanca tenantId={session?.profile?.tenant_id ?? ""} />
        </TabsContent>
        <TabsContent value="chamados">
          <ChamadosAdmin tenantId={session?.profile?.tenant_id ?? ""} />
        </TabsContent>
        <TabsContent value="online">
          <CardapioOnline tenantId={session?.profile?.tenant_id ?? ""} />
        </TabsContent>
        <TabsContent value="delivery">
          <ZonasEntrega tenantId={session?.profile?.tenant_id ?? ""} />
        </TabsContent>
      </Tabs>
    </>
  );
}

/* ===== Balança: taras e buffet livre ===== */
function Balanca({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const { data: taras = [] } = useTaras();
  const salvarTara = useSalvar("restaurante_taras", "Tara salva");
  const [nome, setNome] = useState("");
  const [peso, setPeso] = useState("");
  const { data: config } = useQuery({
    queryKey: [CHAVE_REST, "config-balanca"],
    queryFn: async () => {
      const r = await tabela("restaurante_config")
        .select("buffet_livre_ativo, buffet_livre_preco")
        .maybeSingle();
      if (r.error) throw new Error(r.error.message);
      return (r.data ?? null) as unknown as {
        buffet_livre_ativo: boolean;
        buffet_livre_preco: number | null;
      } | null;
    },
  });
  const [ativo, setAtivo] = useState(false);
  const [preco, setPreco] = useState("");
  useEffect(() => {
    if (config) {
      setAtivo(config.buffet_livre_ativo);
      setPreco(textoNumero(config.buffet_livre_preco));
    }
  }, [config]);

  const salvarBuffet = useMutation({
    mutationFn: async () => {
      const valor = dinheiro(preco);
      if (ativo && valor <= 0) throw new Error("Informe o preço do buffet livre");
      const r = await tabela("restaurante_config").upsert(
        {
          tenant_id: tenantId,
          buffet_livre_ativo: ativo,
          buffet_livre_preco: valor > 0 ? valor : null,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "tenant_id" },
      );
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: () => {
      toast.success("Buffet livre salvo");
      void qc.invalidateQueries({ queryKey: [CHAVE_REST] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mt-4 max-w-2xl space-y-6">
      <section className="space-y-3">
        <h3 className="font-display font-semibold">Taras</h3>
        <p className="text-sm text-muted-foreground">
          Peso do prato ou vasilhame, descontado do peso na balança. Marque o item como “vendido por
          peso” na aba Itens e escolha a tara padrão dele.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="tara-nome">Nova tara</Label>
            <Input
              id="tara-nome"
              value={nome}
              maxLength={40}
              onChange={(e) => setNome(e.target.value)}
              placeholder="ex.: Prato grande"
            />
          </div>
          <div className="w-28">
            <Label htmlFor="tara-peso">Peso (g)</Label>
            <Input
              id="tara-peso"
              inputMode="numeric"
              value={peso}
              onChange={(e) => setPeso(e.target.value)}
            />
          </div>
          <Button
            disabled={!nome.trim() || !(Math.round(dinheiro(peso)) > 0) || salvarTara.isPending}
            onClick={() =>
              salvarTara.mutate(
                {
                  dados: {
                    tenant_id: tenantId,
                    nome: nome.trim(),
                    peso_g: Math.round(dinheiro(peso)),
                  },
                },
                {
                  onSuccess: () => {
                    setNome("");
                    setPeso("");
                  },
                },
              )
            }
          >
            <Plus className="mr-1 size-4" /> Adicionar
          </Button>
        </div>
        {taras.map((t) => (
          <div key={t.id} className="flex items-center justify-between rounded border p-2">
            <span className={t.ativo ? "" : "text-muted-foreground line-through"}>
              {t.nome} <span className="text-xs text-muted-foreground">· {t.peso_g} g</span>
            </span>
            <Switch
              aria-label={`Tara ${t.nome} ativa`}
              checked={t.ativo}
              onCheckedChange={(v) => salvarTara.mutate({ id: t.id, dados: { ativo: v } })}
            />
          </div>
        ))}
        {taras.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma tara cadastrada.</p>
        )}
      </section>

      <section className="space-y-3 rounded border p-3">
        <h3 className="font-display font-semibold">Buffet livre</h3>
        <p className="text-sm text-muted-foreground">
          Com o buffet livre ligado, o prato pesado nunca custa mais do que o preço do buffet livre:
          o sistema cobra o menor entre o peso × preço do KG e este valor. O limite vale por prato
          pesado.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={ativo} onCheckedChange={setAtivo} aria-label="Limitar ao buffet livre" />
          Limitar o prato ao preço do buffet livre
        </label>
        <div className="w-40">
          <Label htmlFor="buffet-preco">Preço do buffet livre (R$)</Label>
          <Input
            id="buffet-preco"
            inputMode="decimal"
            value={preco}
            onChange={(e) => setPreco(e.target.value)}
          />
        </div>
        <Button onClick={() => salvarBuffet.mutate()} disabled={salvarBuffet.isPending}>
          Salvar buffet livre
        </Button>
      </section>
    </div>
  );
}

/* ===== Cardápio online ===== */
function CardapioOnline({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const { data: config } = useQuery({
    queryKey: [CHAVE_REST, "config-online"],
    queryFn: async () => {
      const r = await tabela("restaurante_config").select("cardapio_online").maybeSingle();
      if (r.error) throw new Error(r.error.message);
      return (r.data ?? null) as unknown as { cardapio_online: boolean } | null;
    },
  });
  const { data: slug } = useQuery({
    queryKey: [CHAVE_REST, "slug-empresa"],
    queryFn: async () => {
      const r = await supabase.from("empresas").select("slug").limit(1).maybeSingle();
      if (r.error) throw new Error(r.error.message);
      return ((r.data as { slug?: string | null } | null)?.slug ?? null) as string | null;
    },
  });
  const ligado = config?.cardapio_online ?? false;
  const link =
    slug && typeof window !== "undefined" ? `${window.location.origin}/menu/${slug}` : null;
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!link || !ligado) {
      setQr(null);
      return;
    }
    let ativo = true;
    QRCode.toDataURL(link, { margin: 1, width: 320 })
      .then((u) => ativo && setQr(u))
      .catch(() => ativo && setQr(null));
    return () => {
      ativo = false;
    };
  }, [link, ligado]);

  const alternar = useMutation({
    mutationFn: async (v: boolean) => {
      const r = await tabela("restaurante_config").upsert(
        { tenant_id: tenantId, cardapio_online: v, updated_at: new Date().toISOString() } as never,
        { onConflict: "tenant_id" },
      );
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: () => {
      toast.success("Cardápio online atualizado");
      void qc.invalidateQueries({ queryKey: [CHAVE_REST] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mt-4 max-w-2xl space-y-4">
      <p className="text-sm text-muted-foreground">
        Página pública só para ver o cardápio (sem pedido): categorias, itens ativos, preço, foto,
        descrição e adicionais. Custos, praças e dados de clientes nunca aparecem.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={ligado}
          disabled={alternar.isPending}
          onCheckedChange={(v) => alternar.mutate(v)}
          aria-label="Cardápio online ligado"
        />
        Cardápio online ligado
      </label>
      {!slug && (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          A empresa ainda não tem link de acesso. Defina o link em Empresa para publicar o cardápio.
        </p>
      )}
      {link && ligado && (
        <div className="space-y-3 rounded border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-secondary px-2 py-1 text-sm">{link}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void navigator.clipboard
                  .writeText(link)
                  .then(() => toast.success("Link copiado"))
                  .catch(() => toast.error("Não foi possível copiar"))
              }
            >
              <Copy className="mr-1 size-4" /> Copiar
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={link} target="_blank" rel="noreferrer">
                Abrir
              </a>
            </Button>
          </div>
          {qr && (
            <div>
              <img src={qr} alt="QR code do cardápio online" className="size-40" />
              <a href={qr} download="qr-cardapio.png" className="text-sm underline">
                Baixar QR code
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ===== Praças de produção ===== */
const SUGESTOES_PRACA = ["Churrascaria", "Lanches", "Pizzaria", "Sobremesas"];

function Pracas({ tenantId }: { tenantId: string }) {
  const { data: pracas = [] } = usePracas();
  const salvar = useSalvar("restaurante_pracas", "Praça salva");
  const [nome, setNome] = useState("");

  const adicionar = (n: string) =>
    salvar.mutate(
      { dados: { tenant_id: tenantId, nome: n.trim() } },
      { onSuccess: () => setNome("") },
    );
  const jaTem = (n: string) => pracas.some((p) => p.nome.toLowerCase() === n.toLowerCase());

  return (
    <div className="mt-4 max-w-2xl space-y-3">
      <p className="text-sm text-muted-foreground">
        Praça é o lugar onde o item é preparado. Cozinha e Bar já existem. Cadastre as outras e
        escolha a praça em cada item do cardápio: o pedido enviado aparece só na tela da praça certa
        (Cozinha, filtro no topo).
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <Label htmlFor="praca-nome">Nova praça</Label>
          <Input
            id="praca-nome"
            value={nome}
            maxLength={40}
            onChange={(e) => setNome(e.target.value)}
            placeholder="ex.: Churrascaria"
          />
        </div>
        <Button disabled={!nome.trim() || salvar.isPending} onClick={() => adicionar(nome)}>
          <Plus className="mr-1 size-4" /> Adicionar
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        {SUGESTOES_PRACA.filter((n) => !jaTem(n)).map((n) => (
          <Button
            key={n}
            size="sm"
            variant="outline"
            disabled={salvar.isPending}
            onClick={() => adicionar(n)}
          >
            <Plus className="mr-1 size-3" /> {n}
          </Button>
        ))}
      </div>
      {["Cozinha", "Bar"].map((n) => (
        <div
          key={n}
          className="flex items-center justify-between rounded border bg-secondary/40 p-2"
        >
          <span>{n}</span>
          <span className="text-xs text-muted-foreground">fixa</span>
        </div>
      ))}
      {pracas.map((p) => (
        <div key={p.id} className="flex items-center justify-between rounded border p-2">
          <span className={p.ativo ? "" : "text-muted-foreground line-through"}>{p.nome}</span>
          <Switch
            aria-label={`Praça ${p.nome} ativa`}
            checked={p.ativo}
            onCheckedChange={(v) => salvar.mutate({ id: p.id, dados: { ativo: v } })}
          />
        </div>
      ))}
    </div>
  );
}

/* ===== Zonas de entrega ===== */
function ZonasEntrega({ tenantId }: { tenantId: string }) {
  const { data: zonas = [] } = useZonasEntrega();
  const salvar = useSalvar("restaurante_zonas_entrega", "Zona salva");
  const [nome, setNome] = useState("");
  const [taxa, setTaxa] = useState("0");

  return (
    <div className="mt-4 max-w-2xl space-y-3">
      <p className="text-sm text-muted-foreground">
        Bairros ou regiões atendidas, cada uma com a sua taxa. Na hora do pedido, escolher a zona
        preenche a taxa (que ainda pode ser ajustada).
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <Label htmlFor="zona-nome">Nova zona</Label>
          <Input
            id="zona-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="ex.: Centro"
          />
        </div>
        <div className="w-28">
          <Label htmlFor="zona-taxa">Taxa (R$)</Label>
          <Input
            id="zona-taxa"
            inputMode="decimal"
            value={taxa}
            onChange={(e) => setTaxa(e.target.value)}
          />
        </div>
        <Button
          disabled={!nome.trim() || salvar.isPending}
          onClick={() =>
            salvar.mutate(
              {
                dados: {
                  tenant_id: tenantId,
                  nome: nome.trim(),
                  taxa: Number(taxa.replace(",", ".")) || 0,
                },
              },
              {
                onSuccess: () => {
                  setNome("");
                  setTaxa("0");
                },
              },
            )
          }
        >
          <Plus className="mr-1 size-4" /> Adicionar
        </Button>
      </div>
      {zonas.map((z) => (
        <div key={z.id} className="flex items-center justify-between rounded border p-2">
          <span className={z.ativo ? "" : "text-muted-foreground line-through"}>
            {z.nome} <span className="text-xs text-muted-foreground">· {brl(z.taxa)}</span>
          </span>
          <Switch
            aria-label={`Zona ${z.nome} ativa`}
            checked={z.ativo}
            onCheckedChange={(v) => salvar.mutate({ id: z.id, dados: { ativo: v } })}
          />
        </div>
      ))}
      {zonas.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma zona cadastrada.</p>
      )}
    </div>
  );
}

/** Grava (insere ou altera) e atualiza as listas do restaurante. */
function useSalvar(tab: string, mensagem: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id?: string; dados: Record<string, unknown> }) => {
      const r = p.id
        ? await tabela(tab)
            .update(p.dados as never)
            .eq("id", p.id)
        : await tabela(tab).insert(p.dados as never);
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: () => {
      toast.success(mensagem);
      void qc.invalidateQueries({ queryKey: [CHAVE_REST] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* ===== Categorias ===== */
function Categorias({ tenantId }: { tenantId: string }) {
  const { data } = useCardapio(true);
  const salvar = useSalvar("cardapio_categorias", "Categoria salva");
  const [nome, setNome] = useState("");
  const [ordem, setOrdem] = useState("0");

  return (
    <div className="mt-4 max-w-2xl space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <Label htmlFor="cat-nome">Nova categoria</Label>
          <Input
            id="cat-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="ex.: Bebidas"
          />
        </div>
        <div className="w-24">
          <Label htmlFor="cat-ordem">Ordem</Label>
          <Input
            id="cat-ordem"
            inputMode="numeric"
            value={ordem}
            onChange={(e) => setOrdem(e.target.value)}
          />
        </div>
        <Button
          disabled={!nome.trim() || salvar.isPending}
          onClick={() =>
            salvar.mutate(
              { dados: { tenant_id: tenantId, nome: nome.trim(), ordem: Number(ordem) || 0 } },
              { onSuccess: () => setNome("") },
            )
          }
        >
          <Plus className="mr-1 size-4" /> Adicionar
        </Button>
      </div>
      {(data?.categorias ?? []).map((c: CardapioCategoria) => (
        <div key={c.id} className="flex items-center justify-between rounded border p-2">
          <span className={c.ativo ? "" : "text-muted-foreground line-through"}>
            {c.nome} <span className="text-xs text-muted-foreground">· ordem {c.ordem}</span>
          </span>
          <Switch
            aria-label={`Categoria ${c.nome} ativa`}
            checked={c.ativo}
            onCheckedChange={(v) => salvar.mutate({ id: c.id, dados: { ativo: v } })}
          />
        </div>
      ))}
    </div>
  );
}

/* ===== Mesas ===== */
function Mesas({ tenantId }: { tenantId: string }) {
  const { data: session } = useSessionData();
  const salvar = useSalvar("mesas", "Mesa salva");
  const [numero, setNumero] = useState("");
  const [capacidade, setCapacidade] = useState("");
  const [filial, setFilial] = useState("todas");
  const { data: mesas = [] } = useQuery({
    queryKey: [CHAVE_REST, "mesas-cadastro"],
    queryFn: async () => {
      const r = await tabela("mesas").select("*");
      if (r.error) throw new Error(r.error.message);
      return ((r.data ?? []) as unknown as Mesa[]).sort((a, b) =>
        a.numero.localeCompare(b.numero, "pt-BR", { numeric: true }),
      );
    },
  });
  const filiais = session?.filiais ?? [];
  const qc = useQueryClient();
  const [quantidade, setQuantidade] = useState("");
  const [filialQtd, setFilialQtd] = useState("todas");

  // mesas numeradas (1, 2, 3...) da loja escolhida: são as que a configuração controla
  const numeradas = mesas.filter(
    (m) => /^\d+$/.test(m.numero) && (m.filial_id ?? "todas") === filialQtd,
  );
  const ativasNumeradas = numeradas.filter((m) => m.ativa).length;

  const definir = useMutation({
    mutationFn: async () => {
      const n = Number(quantidade);
      if (!Number.isInteger(n) || n < 0 || n > 500)
        throw new Error("Informe uma quantidade de mesas entre 0 e 500");
      return rpcRestaurante<{
        criadas: number;
        reativadas: number;
        desativadas: number;
        mantidas_ocupadas: number;
      }>("restaurante_definir_mesas", {
        p_quantidade: n,
        p_filial_id: filialQtd === "todas" ? null : filialQtd,
      });
    },
    onSuccess: (r) => {
      const partes = [
        r.criadas > 0 && `${r.criadas} criada(s)`,
        r.reativadas > 0 && `${r.reativadas} reativada(s)`,
        r.desativadas > 0 && `${r.desativadas} desativada(s)`,
      ].filter(Boolean);
      toast.success(partes.length ? `Mesas atualizadas: ${partes.join(", ")}` : "Nada a alterar");
      if (r.mantidas_ocupadas > 0)
        toast.info(
          `${r.mantidas_ocupadas} mesa(s) acima da quantidade seguem ativas porque têm comanda aberta`,
        );
      void qc.invalidateQueries({ queryKey: [CHAVE_REST] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mt-4 max-w-2xl space-y-3">
      <div className="space-y-2 rounded border bg-secondary/40 p-3">
        <h3 className="font-display font-semibold">Quantidade de mesas do restaurante</h3>
        <p className="text-sm text-muted-foreground">
          Informe quantas mesas existem e o sistema cria as mesas numeradas de 1 até esse número. Ao
          reduzir, as mesas que sobram são desativadas (mesa com comanda aberta continua ativa).
          Hoje: <strong>{ativasNumeradas}</strong> mesa(s) numerada(s) ativa(s).
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-32">
            <Label htmlFor="qtd-mesas">Quantas mesas</Label>
            <Input
              id="qtd-mesas"
              inputMode="numeric"
              placeholder={String(ativasNumeradas)}
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
            />
          </div>
          {filiais.length > 1 && (
            <div className="w-44">
              <Label>Loja</Label>
              <Select value={filialQtd} onValueChange={setFilialQtd}>
                <SelectTrigger aria-label="Loja da configuração de mesas">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {filiais.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button
            disabled={!quantidade.trim() || definir.isPending}
            onClick={() => definir.mutate()}
          >
            Aplicar
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-28">
          <Label htmlFor="mesa-num">Número</Label>
          <Input
            id="mesa-num"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            placeholder="ex.: 12"
          />
        </div>
        <div className="w-28">
          <Label htmlFor="mesa-cap">Lugares</Label>
          <Input
            id="mesa-cap"
            inputMode="numeric"
            value={capacidade}
            onChange={(e) => setCapacidade(e.target.value)}
          />
        </div>
        {filiais.length > 1 && (
          <div className="w-44">
            <Label>Loja</Label>
            <Select value={filial} onValueChange={setFilial}>
              <SelectTrigger aria-label="Loja da mesa">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                {filiais.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Button
          disabled={!numero.trim() || salvar.isPending}
          onClick={() =>
            salvar.mutate(
              {
                dados: {
                  tenant_id: tenantId,
                  numero: numero.trim(),
                  capacidade: Number(capacidade) > 0 ? Number(capacidade) : null,
                  filial_id: filial === "todas" ? null : filial,
                },
              },
              { onSuccess: () => setNumero("") },
            )
          }
        >
          <Plus className="mr-1 size-4" /> Adicionar mesa
        </Button>
      </div>
      {mesas.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma mesa cadastrada.</p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {mesas.map((m) => (
          <div key={m.id} className="flex items-center justify-between rounded border p-2">
            <span className={m.ativa ? "" : "text-muted-foreground line-through"}>
              Mesa {m.numero}
              {m.capacidade ? (
                <span className="text-xs text-muted-foreground"> · {m.capacidade} lugares</span>
              ) : null}
            </span>
            <Switch
              aria-label={`Mesa ${m.numero} ativa`}
              checked={m.ativa}
              onCheckedChange={(v) => salvar.mutate({ id: m.id, dados: { ativa: v } })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ===== Itens do cardápio ===== */
type FormItem = {
  id?: string;
  nome: string;
  categoria_id: string;
  preco: string;
  estacao: string;
  tempo: string;
  descricao: string;
  ordem: string;
  por_peso: boolean;
  tara_id: string;
  codigo_externo: string;
  preco_ifood: string;
  /** foto gravada no item e foto escolhida agora (só vale ao salvar) */
  foto_path: string | null;
  foto_original: string | null;
  ativo: boolean;
};

const itemVazio: FormItem = {
  nome: "",
  categoria_id: "nenhuma",
  preco: "",
  estacao: "cozinha",
  tempo: "",
  descricao: "",
  ordem: "0",
  por_peso: false,
  tara_id: "nenhuma",
  codigo_externo: "",
  preco_ifood: "",
  foto_path: null,
  foto_original: null,
  ativo: true,
};

function Itens({ tenantId }: { tenantId: string }) {
  const { data } = useCardapio(true);
  const { data: pracas = [] } = usePracas();
  const { data: taras = [] } = useTaras();
  const [form, setForm] = useState<FormItem | null>(null);
  const salvar = useSalvar("cardapio_itens", "Item salvo");
  const categorias = data?.categorias ?? [];

  const doGrupo = (cat: string | null) => (data?.itens ?? []).filter((i) => i.categoria_id === cat);

  function editar(i: CardapioItem) {
    setForm({
      id: i.id,
      nome: i.nome,
      categoria_id: i.categoria_id ?? "nenhuma",
      preco: textoNumero(i.preco),
      estacao: i.estacao,
      tempo: textoNumero(i.tempo_preparo_min),
      descricao: i.descricao ?? "",
      ordem: String(i.ordem ?? 0),
      por_peso: i.venda_por_peso,
      tara_id: i.tara_id ?? "nenhuma",
      codigo_externo: i.codigo_externo ?? "",
      preco_ifood: textoNumero(i.preco_ifood),
      foto_path: i.foto_path,
      foto_original: i.foto_path,
      ativo: i.ativo,
    });
  }

  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const entradaFoto = useRef<HTMLInputElement>(null);

  /** Fecha o formulário; a foto enviada e não salva é descartada. */
  function fecharForm() {
    if (form?.foto_path && form.foto_path !== form.foto_original)
      void apagarFotoCardapio(form.foto_path);
    setForm(null);
  }

  async function escolherFoto(arquivo: File | undefined) {
    if (!arquivo || !form) return;
    setEnviandoFoto(true);
    try {
      const caminho = await enviarFotoCardapio(tenantId, arquivo);
      // troca de foto antes de salvar: a anterior (ainda não salva) é descartada
      if (form.foto_path && form.foto_path !== form.foto_original)
        void apagarFotoCardapio(form.foto_path);
      setForm({ ...form, foto_path: caminho });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar a foto");
    } finally {
      setEnviandoFoto(false);
      if (entradaFoto.current) entradaFoto.current.value = "";
    }
  }

  const gravar = () => {
    if (!form) return;
    if (!form.nome.trim()) {
      toast.error("Informe o nome do item");
      return;
    }
    salvar.mutate(
      {
        ...(form.id ? { id: form.id } : {}),
        dados: {
          ...(form.id ? {} : { tenant_id: tenantId }),
          nome: form.nome.trim(),
          categoria_id: form.categoria_id === "nenhuma" ? null : form.categoria_id,
          preco: dinheiro(form.preco),
          estacao: form.estacao,
          tempo_preparo_min: form.tempo.trim() ? Math.round(dinheiro(form.tempo)) : null,
          descricao: form.descricao.trim() || null,
          ordem: Math.round(dinheiro(form.ordem)),
          venda_por_peso: form.por_peso,
          codigo_externo: form.codigo_externo.trim() || null,
          preco_ifood: form.preco_ifood.trim() ? dinheiro(form.preco_ifood) : null,
          tara_id: form.por_peso && form.tara_id !== "nenhuma" ? form.tara_id : null,
          foto_path: form.foto_path,
          ativo: form.ativo,
        },
      },
      {
        onSuccess: () => {
          // a foto que saiu do item deixa de ocupar espaço
          if (form.foto_original && form.foto_original !== form.foto_path)
            void apagarFotoCardapio(form.foto_original);
          if (!form.id) setForm(null);
          else setForm({ ...form, foto_original: form.foto_path });
        },
      },
    );
  };

  const secoes = [
    ...categorias.map((c) => ({ id: c.id as string | null, titulo: c.nome })),
    { id: null as string | null, titulo: "Sem categoria" },
  ];

  return (
    <div className="mt-4 space-y-5">
      <Button onClick={() => setForm(itemVazio)}>
        <Plus className="mr-1 size-4" /> Novo item
      </Button>

      {(data?.itens.length ?? 0) === 0 && (
        <EmptyState
          title="Cardápio vazio"
          description="Cadastre as categorias e depois os itens com preço e estação."
        />
      )}

      {secoes.map((s) => {
        const lista = doGrupo(s.id);
        if (lista.length === 0) return null;
        return (
          <section key={s.id ?? "sem"}>
            <h2 className="mb-2 font-display text-lg font-semibold">{s.titulo}</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {lista.map((i) => (
                <div
                  key={i.id}
                  className="flex items-start justify-between gap-2 rounded border p-3"
                >
                  {urlFotoCardapio(i.foto_path) && (
                    <img
                      src={urlFotoCardapio(i.foto_path)!}
                      alt=""
                      loading="lazy"
                      className="size-14 shrink-0 rounded object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p
                      className={`font-medium ${i.ativo ? "" : "text-muted-foreground line-through"}`}
                    >
                      {i.nome}
                    </p>
                    <p className="text-sm">
                      {brl(i.preco)}
                      {i.venda_por_peso ? " /kg" : ""}
                    </p>
                    <Badge variant="secondary" className="mt-1">
                      {rotuloEstacao(i.estacao, pracas)}
                    </Badge>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Editar ${i.nome}`}
                    onClick={() => editar(i)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {form && (
        <Dialog open onOpenChange={(o) => !o && fecharForm()}>
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{form.id ? "Editar item" : "Novo item"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="i-nome">Nome</Label>
                <Input
                  id="i-nome"
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                />
              </div>
              <div>
                <Label>Categoria</Label>
                <Select
                  value={form.categoria_id}
                  onValueChange={(v) => setForm({ ...form, categoria_id: v })}
                >
                  <SelectTrigger aria-label="Categoria do item">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhuma">Sem categoria</SelectItem>
                    {categorias.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="i-preco">
                  {form.por_peso ? "Preço por KG (R$)" : "Preço (R$)"}
                </Label>
                <Input
                  id="i-preco"
                  inputMode="decimal"
                  value={form.preco}
                  onChange={(e) => setForm({ ...form, preco: e.target.value })}
                />
              </div>
              <div>
                <Label>Praça de produção (onde é preparado)</Label>
                <Select
                  value={form.estacao}
                  onValueChange={(v) => setForm({ ...form, estacao: v })}
                >
                  <SelectTrigger aria-label="Estação de preparo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cozinha">Cozinha</SelectItem>
                    <SelectItem value="bar">Bar</SelectItem>
                    {pracas
                      .filter((p) => p.ativo || p.codigo === form.estacao)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.codigo}>
                          {p.nome}
                        </SelectItem>
                      ))}
                    <SelectItem value="nenhuma">Pronto para servir (ex.: lata)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="i-tempo">Tempo de preparo (min)</Label>
                <Input
                  id="i-tempo"
                  inputMode="numeric"
                  value={form.tempo}
                  onChange={(e) => setForm({ ...form, tempo: e.target.value })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Switch
                  checked={form.por_peso}
                  onCheckedChange={(v) => setForm({ ...form, por_peso: v })}
                />
                Vendido por peso (o preço acima é por KG; lançado pela Balança)
              </label>
              {form.por_peso && (
                <div className="sm:col-span-2">
                  <Label>Tara padrão (descontada na pesagem)</Label>
                  <Select
                    value={form.tara_id}
                    onValueChange={(v) => setForm({ ...form, tara_id: v })}
                  >
                    <SelectTrigger aria-label="Tara padrão">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nenhuma">Sem tara</SelectItem>
                      {taras
                        .filter((t) => t.ativo || t.id === form.tara_id)
                        .map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.nome} ({t.peso_g} g)
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label htmlFor="i-preco-ifood">Preço no iFood (R$, opcional)</Label>
                <Input
                  id="i-preco-ifood"
                  inputMode="decimal"
                  value={form.preco_ifood}
                  onChange={(e) => setForm({ ...form, preco_ifood: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="i-cod-ifood">Código no iFood (opcional)</Label>
                <Input
                  id="i-cod-ifood"
                  maxLength={100}
                  value={form.codigo_externo}
                  onChange={(e) => setForm({ ...form, codigo_externo: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="i-ordem">Ordem no cardápio</Label>
                <Input
                  id="i-ordem"
                  inputMode="numeric"
                  value={form.ordem}
                  onChange={(e) => setForm({ ...form, ordem: e.target.value })}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Menor número aparece primeiro dentro da categoria.
                </p>
              </div>
              <div>
                <Label>Foto do item</Label>
                <div className="flex items-center gap-2">
                  {urlFotoCardapio(form.foto_path) ? (
                    <img
                      src={urlFotoCardapio(form.foto_path)!}
                      alt={`Foto de ${form.nome || "item"}`}
                      className="size-16 rounded object-cover"
                    />
                  ) : (
                    <div className="flex size-16 items-center justify-center rounded border border-dashed text-muted-foreground">
                      <ImagePlus className="size-6" />
                    </div>
                  )}
                  <div className="space-y-1">
                    <input
                      ref={entradaFoto}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      aria-label="Escolher foto do item"
                      onChange={(e) => void escolherFoto(e.target.files?.[0])}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={enviandoFoto}
                      onClick={() => entradaFoto.current?.click()}
                    >
                      {enviandoFoto
                        ? "Enviando..."
                        : form.foto_path
                          ? "Trocar foto"
                          : "Enviar foto"}
                    </Button>
                    {form.foto_path && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (form.foto_path !== form.foto_original)
                            void apagarFotoCardapio(form.foto_path);
                          setForm({ ...form, foto_path: null });
                        }}
                      >
                        Remover
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="i-desc">Descrição</Label>
                <Textarea
                  id="i-desc"
                  value={form.descricao}
                  onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Switch
                  checked={form.ativo}
                  onCheckedChange={(v) => setForm({ ...form, ativo: v })}
                />
                Item ativo no cardápio
              </label>
            </div>

            {form.id ? (
              <>
                <FichaEditor
                  alvo={{ tipo: "item", id: form.id }}
                  tenantId={tenantId}
                  preco={dinheiro(form.preco)}
                />
                <OpcoesDoItem itemId={form.id} tenantId={tenantId} />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Salve o item para cadastrar as opções (ponto da carne, adicionais...).
              </p>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setForm(null)}>
                Fechar
              </Button>
              <Button onClick={gravar} disabled={salvar.isPending}>
                Salvar item
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/* ===== Grupos de opções e opções de um item ===== */
function OpcoesDoItem({ itemId, tenantId }: { itemId: string; tenantId: string }) {
  const qc = useQueryClient();
  const { data } = useCardapio(true);
  const grupos = (data?.grupos ?? []).filter((g: CardapioGrupo) => g.item_id === itemId);
  const [nomeGrupo, setNomeGrupo] = useState("");
  const [obrigatorio, setObrigatorio] = useState(false);
  const [maximo, setMaximo] = useState("1");

  const atualizar = () => void qc.invalidateQueries({ queryKey: [CHAVE_REST] });
  const erro = (e: Error) => toast.error(e.message);

  const novoGrupo = useMutation({
    mutationFn: async () => {
      const r = await tabela("cardapio_grupos").insert({
        tenant_id: tenantId,
        item_id: itemId,
        nome: nomeGrupo.trim(),
        obrigatorio,
        max_escolhas: Math.max(Math.floor(Number(maximo)) || 1, 1),
      } as never);
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: () => {
      setNomeGrupo("");
      atualizar();
    },
    onError: erro,
  });

  const apagar = useMutation({
    mutationFn: async (p: { tab: string; id: string }) => {
      const r = await tabela(p.tab).delete().eq("id", p.id);
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: atualizar,
    onError: erro,
  });

  return (
    <div className="space-y-3 rounded border p-3">
      <h3 className="font-display font-semibold">Opções do item</h3>
      {grupos.map((g) => (
        <GrupoOpcoes
          key={g.id}
          grupo={g}
          tenantId={tenantId}
          opcoes={(data?.opcoes ?? []).filter((o: CardapioOpcao) => o.grupo_id === g.id)}
          onApagarGrupo={() => apagar.mutate({ tab: "cardapio_grupos", id: g.id })}
          onApagarOpcao={(id) => apagar.mutate({ tab: "cardapio_opcoes", id })}
        />
      ))}
      <div className="flex flex-wrap items-end gap-2 border-t pt-3">
        <div className="min-w-40 flex-1">
          <Label htmlFor="g-nome">Novo grupo</Label>
          <Input
            id="g-nome"
            placeholder="ex.: Ponto da carne"
            value={nomeGrupo}
            onChange={(e) => setNomeGrupo(e.target.value)}
          />
        </div>
        <div className="w-20">
          <Label htmlFor="g-max">Máx.</Label>
          <Input
            id="g-max"
            inputMode="numeric"
            value={maximo}
            onChange={(e) => setMaximo(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <Switch checked={obrigatorio} onCheckedChange={setObrigatorio} />
          Obrigatório
        </label>
        <Button
          type="button"
          disabled={!nomeGrupo.trim() || novoGrupo.isPending}
          onClick={() => novoGrupo.mutate()}
        >
          Adicionar grupo
        </Button>
      </div>
    </div>
  );
}

function GrupoOpcoes({
  grupo,
  opcoes,
  tenantId,
  onApagarGrupo,
  onApagarOpcao,
}: {
  grupo: CardapioGrupo;
  opcoes: CardapioOpcao[];
  tenantId: string;
  onApagarGrupo: () => void;
  onApagarOpcao: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [extra, setExtra] = useState("");
  const [fichaAberta, setFichaAberta] = useState<string | null>(null);

  const nova = useMutation({
    mutationFn: async () => {
      const r = await tabela("cardapio_opcoes").insert({
        tenant_id: tenantId,
        grupo_id: grupo.id,
        nome: nome.trim(),
        preco_adicional: dinheiro(extra),
      } as never);
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: () => {
      setNome("");
      setExtra("");
      void qc.invalidateQueries({ queryKey: [CHAVE_REST] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded bg-secondary/50 p-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          {grupo.nome}{" "}
          <span className="text-xs font-normal text-muted-foreground">
            {grupo.obrigatorio ? "obrigatório" : "opcional"}
            {grupo.max_escolhas > 1 ? ` · até ${grupo.max_escolhas}` : ""}
          </span>
        </p>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Apagar o grupo ${grupo.nome}`}
          onClick={onApagarGrupo}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      <ul className="mt-1 space-y-1 text-sm">
        {opcoes.map((o) => (
          <li key={o.id}>
            <div className="flex items-center justify-between">
              <span>
                {o.nome}
                {Number(o.preco_adicional) > 0 && (
                  <span className="text-muted-foreground"> · + {brl(o.preco_adicional)}</span>
                )}
              </span>
              <span className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Insumos de ${o.nome}`}
                  onClick={() => setFichaAberta(fichaAberta === o.id ? null : o.id)}
                >
                  Insumos
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Apagar ${o.nome}`}
                  onClick={() => onApagarOpcao(o.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </span>
            </div>
            {fichaAberta === o.id && (
              <div className="mt-1">
                <FichaEditor alvo={{ tipo: "opcao", id: o.id }} tenantId={tenantId} />
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <Input
          className="h-8"
          placeholder="Nova opção"
          aria-label={`Nova opção de ${grupo.nome}`}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
        <Input
          className="h-8 w-24"
          placeholder="+ R$"
          aria-label="Acréscimo"
          inputMode="decimal"
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
        />
        <Button
          size="sm"
          type="button"
          disabled={!nome.trim() || nova.isPending}
          onClick={() => nova.mutate()}
        >
          Incluir
        </Button>
      </div>
    </div>
  );
}
