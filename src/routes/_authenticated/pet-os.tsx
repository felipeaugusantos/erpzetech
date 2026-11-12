import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardList,
  ListChecks,
  Pencil,
  Plus,
  Printer,
  Search,
  Tag,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { EtiquetaProdutoDialog } from "@/components/app/EtiquetaProdutoDialog";
import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import type { DadosEtiqueta } from "@/lib/etiqueta";
import { etiquetaDoPet } from "@/lib/etiqueta-pet";
import { brl, dateBR } from "@/lib/format";
import { ESPECIES, idadeDoPet, rotulo } from "@/lib/pet";
import {
  PRIORIDADES_OS,
  SITUACOES_OS_PET,
  osEncerrada,
  proximaSituacaoOsPet,
  rotuloSituacaoOsPet,
  rotuloTipoItemOs,
  totalDoItem,
  type ItemOsPet,
  type ResumoPetOs,
} from "@/lib/pet-os";

export const Route = createFileRoute("/_authenticated/pet-os")({
  head: () => ({
    meta: [
      { title: "Ordens de serviço do pet — EZRA ERP" },
      {
        name: "description",
        content: "Ordem de serviço do pet com os dados do animal, produtos e serviços.",
      },
    ],
  }),
  component: PetOsModulo,
});

const NENHUM = "__nenhum";

type Form = {
  id?: string;
  pet_id: string;
  queixa: string;
  observacoes: string;
  prioridade: string;
  previsao: string;
  profissional_id: string;
  desconto: string;
};
const vazio: Form = {
  pet_id: "",
  queixa: "",
  observacoes: "",
  prioridade: "normal",
  previsao: "",
  profissional_id: "",
  desconto: "0",
};
type ItemForm = { produto_id: string; descricao: string; quantidade: string; preco: string };
const itemVazio: ItemForm = { produto_id: "", descricao: "", quantidade: "1", preco: "" };

function PetOsModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.petshop) return <ModuloBloqueado modulo="petshop" />;
  return <PetOs />;
}

function PetOs() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const podeEditar = (session?.roles ?? []).some((r) =>
    ["administrador", "gestor", "vendedor", "caixa"].includes(r),
  );
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("abertas");
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Form>(vazio);
  const [buscaPet, setBuscaPet] = useState("");
  const [osAberta, setOsAberta] = useState<string | null>(null);
  const [ficha, setFicha] = useState<DadosEtiqueta[] | null>(null);
  const [item, setItem] = useState<ItemForm>(itemVazio);

  const { data: ordens = [], isLoading } = useQuery({
    queryKey: ["pet-os"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("os_ordens")
        .select(
          "id, numero, situacao, abertura, previsao, prioridade, defeito_relatado, observacoes, desconto, valor_pecas, valor_servicos, valor_total, tecnico_nome, pet_id, pet_resumo, pet_profissional_id, deposito_id, venda_id",
        )
        .not("pet_id", "is", null)
        .order("numero", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
  });

  const { data: pets = [] } = useQuery({
    queryKey: ["pet-os-pets"],
    queryFn: async () => {
      const [p, c] = await Promise.all([
        supabase
          .from("pets")
          .select("id, nome, especie, raca, cliente_id")
          .eq("ativo", true)
          .order("nome")
          .limit(2000),
        supabase.from("clientes").select("id, nome").is("deleted_at", null).limit(2000),
      ]);
      if (p.error) throw p.error;
      if (c.error) throw c.error;
      const nomes = new Map((c.data ?? []).map((x) => [x.id, x.nome]));
      return (p.data ?? []).map((x) => ({ ...x, tutor: nomes.get(x.cliente_id) ?? "—" }));
    },
  });

  const { data: profissionais = [] } = useQuery({
    queryKey: ["pet-os-profissionais"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pet_profissionais")
        .select("id, nome, funcao")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ["pet-os-produtos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("produtos")
        .select("id, descricao, preco_venda, controla_estoque")
        .eq("ativo", true)
        .order("descricao")
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: itens = [] } = useQuery({
    queryKey: ["pet-os-itens", osAberta],
    enabled: Boolean(osAberta),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("os_itens")
        .select("id, tipo, descricao, quantidade, preco_unitario, total")
        .eq("os_id", osAberta as string)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as ItemOsPet[];
    },
  });

  const ordem = ordens.find((o) => o.id === osAberta) ?? null;
  const resumo = (o: { pet_resumo: unknown }) => (o.pet_resumo ?? {}) as Partial<ResumoPetOs>;

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return ordens.filter((o) => {
      if (
        filtro === "abertas" ? osEncerrada(o.situacao) : filtro !== "todas" && o.situacao !== filtro
      )
        return false;
      if (!t) return true;
      const r = (o.pet_resumo ?? {}) as Partial<ResumoPetOs>;
      return [String(o.numero), r.nome, r.tutor, r.raca, r.microchip]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(t));
    });
  }, [ordens, busca, filtro]);

  const petsFiltrados = useMemo(() => {
    const t = buscaPet.trim().toLowerCase();
    const base = t
      ? pets.filter((p) =>
          [p.nome, p.tutor, p.raca].some((v) => (v ?? "").toLowerCase().includes(t)),
        )
      : pets;
    return base.slice(0, 100);
  }, [pets, buscaPet]);

  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["pet-os"] });
    void qc.invalidateQueries({ queryKey: ["pet-os-itens"] });
  };

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.id && !form.pet_id) throw new Error("Escolha o animal.");
      const desconto = Number(form.desconto.replace(",", ".") || 0);
      if (!Number.isFinite(desconto) || desconto < 0) throw new Error("Desconto inválido.");
      const { data, error } = await supabase.rpc("pet_os_salvar", {
        p_dados: {
          ...(form.id ? { id: form.id } : { pet_id: form.pet_id }),
          queixa: form.queixa,
          observacoes: form.observacoes,
          prioridade: form.prioridade,
          previsao: form.previsao || null,
          profissional_id: form.profissional_id || null,
          desconto,
        },
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success(form.id ? "Ordem atualizada." : "Ordem de serviço aberta.");
      setAberto(false);
      if (!form.id) setOsAberta(id);
      setForm(vazio);
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const adicionar = useMutation({
    mutationFn: async () => {
      if (!osAberta) return;
      const quantidade = Number(item.quantidade.replace(",", ".") || 0);
      const preco = item.preco.trim() === "" ? undefined : Number(item.preco.replace(",", "."));
      if (!(quantidade > 0)) throw new Error("Quantidade inválida.");
      if (preco !== undefined && !(preco >= 0)) throw new Error("Preço inválido.");
      const { error } = await supabase.rpc("pet_os_item_adicionar", {
        p_os_id: osAberta,
        p_dados: {
          produto_id: item.produto_id || null,
          descricao: item.descricao,
          quantidade,
          ...(preco !== undefined ? { preco } : {}),
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setItem(itemVazio);
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("pet_os_item_remover", { p_item_id: id });
      if (error) throw error;
    },
    onSuccess: recarregar,
    onError: (e: Error) => toast.error(e.message),
  });

  const mudarSituacao = useMutation({
    mutationFn: async (situacao: string) => {
      if (!osAberta) return;
      const { error } = await supabase.rpc("pet_os_situacao", {
        p_os_id: osAberta,
        p_situacao: situacao,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Situação atualizada.");
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const andamento = ordens.filter((o) => !osEncerrada(o.situacao));
  const prox = ordem ? proximaSituacaoOsPet(ordem.situacao) : null;
  const encerrada = ordem ? osEncerrada(ordem.situacao) : true;
  const r = ordem ? resumo(ordem) : {};

  return (
    <div>
      <PageHeader
        title="Ordens de serviço do pet"
        description="Ordem de serviço com os dados do animal, produtos (saem do estoque na aprovação) e serviços."
        actions={
          podeEditar ? (
            <Button
              onClick={() => {
                setForm(vazio);
                setBuscaPet("");
                setAberto(true);
              }}
            >
              <Plus className="size-4" /> Nova ordem
            </Button>
          ) : undefined
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Em andamento" value={String(andamento.length)} icon={ClipboardList} />
        <StatCard
          label="Prontas para entrega"
          value={String(ordens.filter((o) => o.situacao === "pronta").length)}
          tone="success"
        />
        <StatCard
          label="Valor em andamento"
          value={brl(andamento.reduce((s, o) => s + Number(o.valor_total ?? 0), 0))}
          tone="accent"
        />
      </div>

      <div className="panel mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por número, animal, tutor ou microchip"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <Select value={filtro} onValueChange={setFiltro}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="abertas">Somente em andamento</SelectItem>
            <SelectItem value="todas">Todas as ordens</SelectItem>
            {SITUACOES_OS_PET.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhuma ordem de serviço"
          description="Abra uma ordem escolhendo o animal; os dados dele ficam guardados na ordem."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead>
                <TableHead>Animal</TableHead>
                <TableHead>Tutor</TableHead>
                <TableHead>Previsão</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((o) => {
                const x = resumo(o);
                return (
                  <TableRow key={o.id}>
                    <TableCell className="text-numeric font-semibold">{o.numero}</TableCell>
                    <TableCell>
                      <p className="font-medium">{x.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {[rotulo(ESPECIES, x.especie), x.raca].filter(Boolean).join(" · ")}
                      </p>
                    </TableCell>
                    <TableCell>{x.tutor ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{dateBR(o.previsao)}</TableCell>
                    <TableCell>
                      <Badge variant={o.situacao === "cancelada" ? "outline" : "secondary"}>
                        {rotuloSituacaoOsPet(o.situacao)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-numeric font-semibold">
                      {brl(Number(o.valor_total ?? 0))}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setOsAberta(o.id)}>
                        <ListChecks className="size-4" /> Abrir
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* nova ordem / editar */}
      <Dialog open={aberto} onOpenChange={(o) => !o && setAberto(false)}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar ordem" : "Nova ordem de serviço"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            {!form.id && (
              <div>
                <Label htmlFor="os-busca">Animal</Label>
                <Input
                  id="os-busca"
                  placeholder="Buscar por animal, tutor ou raça"
                  value={buscaPet}
                  onChange={(e) => setBuscaPet(e.target.value)}
                />
                <Select
                  value={form.pet_id || NENHUM}
                  onValueChange={(v) => setForm({ ...form, pet_id: v === NENHUM ? "" : v })}
                >
                  <SelectTrigger className="mt-2" aria-label="Animal">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NENHUM}>Escolha o animal…</SelectItem>
                    {petsFiltrados.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nome} — {p.tutor}
                        {p.raca ? ` (${p.raca})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label htmlFor="os-queixa">Motivo / queixa do tutor</Label>
              <Textarea
                id="os-queixa"
                rows={3}
                value={form.queixa}
                onChange={(e) => setForm({ ...form, queixa: e.target.value })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="os-prio">Prioridade</Label>
                <Select
                  value={form.prioridade}
                  onValueChange={(v) => setForm({ ...form, prioridade: v })}
                >
                  <SelectTrigger id="os-prio">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORIDADES_OS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="os-prev">Previsão</Label>
                <Input
                  id="os-prev"
                  type="date"
                  value={form.previsao}
                  onChange={(e) => setForm({ ...form, previsao: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="os-desc">Desconto (R$)</Label>
                <Input
                  id="os-desc"
                  inputMode="decimal"
                  value={form.desconto}
                  onChange={(e) => setForm({ ...form, desconto: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="os-prof">Profissional</Label>
              <Select
                value={form.profissional_id || NENHUM}
                onValueChange={(v) => setForm({ ...form, profissional_id: v === NENHUM ? "" : v })}
              >
                <SelectTrigger id="os-prof">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NENHUM}>Sem profissional definido</SelectItem>
                  {profissionais.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="os-obs">Observações</Label>
              <Textarea
                id="os-obs"
                rows={2}
                value={form.observacoes}
                onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ordem aberta: dados do animal, itens e andamento */}
      <Dialog open={Boolean(ordem)} onOpenChange={(o) => !o && setOsAberta(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          {ordem && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Ordem nº {ordem.numero} · {rotuloSituacaoOsPet(ordem.situacao)}
                </DialogTitle>
              </DialogHeader>

              <div className="grid gap-1 rounded-md border border-border p-3 text-sm sm:grid-cols-2">
                <p>
                  <span className="text-muted-foreground">Animal: </span>
                  <strong>{r.nome}</strong> · {rotulo(ESPECIES, r.especie)}
                  {r.raca ? ` · ${r.raca}` : ""}
                </p>
                <p>
                  <span className="text-muted-foreground">Tutor(a): </span>
                  {r.tutor}
                  {r.tutor_telefone ? ` · ${r.tutor_telefone}` : ""}
                </p>
                <p>
                  <span className="text-muted-foreground">Idade / peso: </span>
                  {idadeDoPet(r.nascimento) || "—"}
                  {r.peso_kg ? ` · ${String(r.peso_kg).replace(".", ",")} kg` : ""}
                </p>
                <p>
                  <span className="text-muted-foreground">Microchip: </span>
                  {r.microchip ?? "—"}
                </p>
                {r.alergias && (
                  <p className="sm:col-span-2">
                    <span className="text-muted-foreground">Alergias: </span>
                    <strong>{r.alergias}</strong>
                  </p>
                )}
                {ordem.defeito_relatado && (
                  <p className="sm:col-span-2">
                    <span className="text-muted-foreground">Motivo: </span>
                    {ordem.defeito_relatado}
                  </p>
                )}
                {ordem.tecnico_nome && (
                  <p>
                    <span className="text-muted-foreground">Profissional: </span>
                    {ordem.tecnico_nome}
                  </p>
                )}
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Qtd.</TableHead>
                    <TableHead className="text-right">Preço</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itens.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        Nenhum item ainda.
                      </TableCell>
                    </TableRow>
                  ) : (
                    itens.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell>{i.descricao}</TableCell>
                        <TableCell>{rotuloTipoItemOs(i.tipo)}</TableCell>
                        <TableCell className="text-right text-numeric">
                          {String(i.quantidade).replace(".", ",")}
                        </TableCell>
                        <TableCell className="text-right text-numeric">
                          {brl(Number(i.preco_unitario))}
                        </TableCell>
                        <TableCell className="text-right text-numeric">
                          {brl(Number(i.total))}
                        </TableCell>
                        <TableCell className="text-right">
                          {podeEditar && !encerrada && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Remover ${i.descricao}`}
                              onClick={() => remover.mutate(i.id)}
                              disabled={remover.isPending}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              {podeEditar && !encerrada && (
                <div className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_5rem_7rem_auto] sm:items-end">
                  <div>
                    <Label htmlFor="it-prod" className="text-xs">
                      Produto ou serviço
                    </Label>
                    <Select
                      value={item.produto_id || NENHUM}
                      onValueChange={(v) => {
                        const p = produtos.find((x) => x.id === v);
                        setItem({
                          ...item,
                          produto_id: v === NENHUM ? "" : v,
                          preco: p ? String(p.preco_venda ?? "").replace(".", ",") : item.preco,
                        });
                      }}
                    >
                      <SelectTrigger id="it-prod">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NENHUM}>Item avulso (digitar abaixo)</SelectItem>
                        {produtos.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.descricao}
                            {p.controla_estoque ? "" : " (serviço)"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!item.produto_id && (
                      <Input
                        className="mt-2"
                        aria-label="Descrição do item avulso"
                        placeholder="Descrição do serviço"
                        value={item.descricao}
                        onChange={(e) => setItem({ ...item, descricao: e.target.value })}
                      />
                    )}
                  </div>
                  <div>
                    <Label htmlFor="it-qtd" className="text-xs">
                      Qtd.
                    </Label>
                    <Input
                      id="it-qtd"
                      inputMode="decimal"
                      value={item.quantidade}
                      onChange={(e) => setItem({ ...item, quantidade: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="it-preco" className="text-xs">
                      Preço (R$)
                    </Label>
                    <Input
                      id="it-preco"
                      inputMode="decimal"
                      value={item.preco}
                      onChange={(e) => setItem({ ...item, preco: e.target.value })}
                    />
                  </div>
                  <Button onClick={() => adicionar.mutate()} disabled={adicionar.isPending}>
                    Adicionar
                  </Button>
                </div>
              )}
              {item.produto_id === "" && item.preco === "" ? null : (
                <p className="text-xs text-muted-foreground">
                  Subtotal do item:{" "}
                  {brl(
                    totalDoItem(
                      Number(item.quantidade.replace(",", ".")) || 0,
                      Number(item.preco.replace(",", ".")) || 0,
                    ),
                  )}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  Produtos {brl(Number(ordem.valor_pecas ?? 0))} · Serviços{" "}
                  {brl(Number(ordem.valor_servicos ?? 0))}
                  {Number(ordem.desconto) > 0 ? ` · Desconto ${brl(Number(ordem.desconto))}` : ""}
                </span>
                <strong className="text-base">
                  Total {brl(Number(ordem.valor_total ?? 0))}
                  {ordem.venda_id ? " · cobrada no caixa" : ""}
                </strong>
              </div>

              <DialogFooter className="flex-wrap gap-2">
                <Button asChild variant="outline">
                  <Link to="/pet-os-documento" search={{ id: ordem.id }}>
                    <Printer className="size-4" /> Imprimir
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const r = resumo(ordem);
                    setFicha([
                      etiquetaDoPet({
                        pet: {
                          nome: r.nome ?? "",
                          especie: r.especie ?? null,
                          raca: r.raca ?? null,
                          porte: r.porte ?? null,
                          alergias: r.alergias ?? null,
                        },
                        tutor: { nome: r.tutor ?? null, telefone: r.tutor_telefone ?? null },
                        os: {
                          numero: ordem.numero,
                          previsao: ordem.previsao,
                          servicos: itens.filter((i) => i.tipo !== "peca").map((i) => i.descricao),
                        },
                      }),
                    ]);
                  }}
                >
                  <Tag className="size-4" /> Ficha do animal
                </Button>
                {podeEditar && !encerrada && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setForm({
                          id: ordem.id,
                          pet_id: ordem.pet_id ?? "",
                          queixa: ordem.defeito_relatado ?? "",
                          observacoes: ordem.observacoes ?? "",
                          prioridade: ordem.prioridade,
                          previsao: ordem.previsao ?? "",
                          profissional_id: ordem.pet_profissional_id ?? "",
                          desconto: String(ordem.desconto ?? 0),
                        });
                        setAberto(true);
                      }}
                    >
                      <Pencil className="size-4" /> Editar
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => mudarSituacao.mutate("cancelada")}
                      disabled={mudarSituacao.isPending}
                    >
                      Cancelar ordem
                    </Button>
                    {ordem.situacao === "pronta" && Number(ordem.valor_total ?? 0) > 0 ? (
                      <Button asChild>
                        <Link to="/frente-caixa" search={{ os: ordem.id }}>
                          Cobrar no caixa
                        </Link>
                      </Button>
                    ) : (
                      prox && (
                        <Button
                          onClick={() => mudarSituacao.mutate(prox.para)}
                          disabled={mudarSituacao.isPending}
                        >
                          {prox.rotulo}
                        </Button>
                      )
                    )}
                  </>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <EtiquetaProdutoDialog itens={ficha} onClose={() => setFicha(null)} />
    </div>
  );
}
