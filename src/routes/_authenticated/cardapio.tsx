import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
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
import { useSessionData } from "@/hooks/useSessionData";
import { useModulosCnae } from "@/lib/cnae";
import { brl } from "@/lib/format";
import { ROTULO_ESTACAO, ehGestaoSalao } from "@/lib/restaurante";
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

export const Route = createFileRoute("/_authenticated/cardapio")({
  head: () => ({
    meta: [
      { title: "Cardápio e mesas — ERP Ze Tech" },
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
          <TabsTrigger value="categorias">Categorias</TabsTrigger>
          <TabsTrigger value="mesas">Mesas</TabsTrigger>
          <TabsTrigger value="estoque">Estoque e custos</TabsTrigger>
        </TabsList>
        <TabsContent value="itens">
          <Itens tenantId={session?.profile?.tenant_id ?? ""} />
        </TabsContent>
        <TabsContent value="categorias">
          <Categorias tenantId={session?.profile?.tenant_id ?? ""} />
        </TabsContent>
        <TabsContent value="mesas">
          <Mesas tenantId={session?.profile?.tenant_id ?? ""} />
        </TabsContent>
        <TabsContent value="estoque">
          <EstoqueRestaurante tenantId={session?.profile?.tenant_id ?? ""} />
        </TabsContent>
      </Tabs>
    </>
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
  estacao: "cozinha" | "bar" | "nenhuma";
  tempo: string;
  descricao: string;
  ativo: boolean;
};

const itemVazio: FormItem = {
  nome: "",
  categoria_id: "nenhuma",
  preco: "",
  estacao: "cozinha",
  tempo: "",
  descricao: "",
  ativo: true,
};

function Itens({ tenantId }: { tenantId: string }) {
  const { data } = useCardapio(true);
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
      ativo: i.ativo,
    });
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
          ativo: form.ativo,
        },
      },
      {
        onSuccess: () => {
          if (!form.id) setForm(null);
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
                  <div>
                    <p
                      className={`font-medium ${i.ativo ? "" : "text-muted-foreground line-through"}`}
                    >
                      {i.nome}
                    </p>
                    <p className="text-sm">{brl(i.preco)}</p>
                    <Badge variant="secondary" className="mt-1">
                      {ROTULO_ESTACAO[i.estacao]}
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
        <Dialog open onOpenChange={(o) => !o && setForm(null)}>
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
                <Label htmlFor="i-preco">Preço (R$)</Label>
                <Input
                  id="i-preco"
                  inputMode="decimal"
                  value={form.preco}
                  onChange={(e) => setForm({ ...form, preco: e.target.value })}
                />
              </div>
              <div>
                <Label>Onde é preparado</Label>
                <Select
                  value={form.estacao}
                  onValueChange={(v) => setForm({ ...form, estacao: v as FormItem["estacao"] })}
                >
                  <SelectTrigger aria-label="Estação de preparo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cozinha">Cozinha</SelectItem>
                    <SelectItem value="bar">Bar</SelectItem>
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
