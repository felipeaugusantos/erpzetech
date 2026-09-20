import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks, Pencil, Plus, Search, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, dateBR, num } from "@/lib/format";
import { ClienteCombobox } from "@/components/app/ClienteCombobox";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/assistencia")({
  head: () => ({
    meta: [
      { title: "Assistência técnica — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Ordens de serviço da assistência técnica: equipamento, defeito, diagnóstico, peças, mão de obra e entrega.",
      },
      { property: "og:title", content: "Assistência técnica — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Abertura, reparo e entrega de ordens de serviço com peças e mão de obra.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AssistenciaModulo,
});

/** Etapas da ordem de serviço, na ordem do atendimento. */
export const SITUACOES_OS: { value: string; label: string }[] = [
  { value: "aberta", label: "Aberta" },
  { value: "em_analise", label: "Em análise" },
  { value: "orcamento", label: "Orçamento enviado" },
  { value: "aprovada", label: "Aprovada" },
  { value: "em_reparo", label: "Em reparo" },
  { value: "pronta", label: "Pronta" },
  { value: "entregue", label: "Entregue" },
  { value: "cancelada", label: "Cancelada" },
];

const rotuloSituacao = (v: string) => SITUACOES_OS.find((s) => s.value === v)?.label ?? v;

type Form = {
  id?: string;
  cliente_id: string;
  equipamento: string;
  marca: string;
  modelo: string;
  numero_serie: string;
  acessorios: string;
  defeito_relatado: string;
  diagnostico: string;
  laudo: string;
  tecnico_nome: string;
  tecnico_id: string;
  prioridade: string;
  situacao: string;
  previsao: string;
  garantia_dias: string;
  horas_trabalhadas: string;
  desconto: string;
  observacoes: string;
};

const vazio: Form = {
  cliente_id: "",
  equipamento: "",
  marca: "",
  modelo: "",
  numero_serie: "",
  acessorios: "",
  defeito_relatado: "",
  diagnostico: "",
  laudo: "",
  tecnico_nome: "",
  tecnico_id: "",
  prioridade: "normal",
  situacao: "aberta",
  previsao: "",
  garantia_dias: "90",
  horas_trabalhadas: "0",
  desconto: "0",
  observacoes: "",
};

type ItemForm = { tipo: string; produto_id: string; descricao: string; quantidade: string; preco: string };
const itemVazio: ItemForm = { tipo: "peca", produto_id: "", descricao: "", quantidade: "1", preco: "0" };

function Assistencia() {
  const { data: session } = useSessionData();
  const profile = session?.profile;
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("todas");
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Form>(vazio);
  const [osAberta, setOsAberta] = useState<string | null>(null);
  const [item, setItem] = useState<ItemForm>(itemVazio);

  const { data: ordens = [], isLoading } = useQuery({
    queryKey: ["os-ordens"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("os_ordens")
        .select("*, clientes(nome)")
        .order("numero", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ["clientes-basico"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("id, nome, cpf, cnpj, telefone")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data;
    },
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-os"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("produtos")
        .select("id, descricao, preco_venda")
        .eq("ativo", true)
        .order("descricao")
        .limit(500);
      if (error) throw error;
      return data;
    },
  });

  const { data: tecnicos = [] } = useQuery({
    queryKey: ["tecnicos-ativos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tecnicos")
        .select("id, nome, especialidade")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data;
    },
  });

  const { data: itens = [] } = useQuery({
    queryKey: ["os-itens", osAberta],
    enabled: !!osAberta,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("os_itens")
        .select("*")
        .eq("os_id", osAberta!)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return ordens.filter((o) => {
      const okFiltro =
        filtro === "todas"
          ? true
          : filtro === "abertas"
            ? !["entregue", "cancelada"].includes(o.situacao)
            : o.situacao === filtro;
      if (!okFiltro) return false;
      if (!t) return true;
      return [o.equipamento, o.marca, o.modelo, o.numero_serie, o.clientes?.nome, String(o.numero)]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(t));
    });
  }, [ordens, busca, filtro]);

  const ordem = useMemo(() => ordens.find((o) => o.id === osAberta) ?? null, [ordens, osAberta]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!profile?.tenant_id) throw new Error("Usuário sem empresa vinculada");
      if (!form.equipamento.trim()) throw new Error("Informe o equipamento");
      const payload = {
        tenant_id: profile.tenant_id,
        empresa_id: profile.empresa_id ?? null,
        filial_id: profile.filial_id ?? null,
        cliente_id: form.cliente_id || null,
        equipamento: form.equipamento.trim(),
        marca: form.marca || null,
        modelo: form.modelo || null,
        numero_serie: form.numero_serie || null,
        acessorios: form.acessorios || null,
        defeito_relatado: form.defeito_relatado || null,
        diagnostico: form.diagnostico || null,
        laudo: form.laudo || null,
        tecnico_nome: form.tecnico_nome || null,
        tecnico_id: form.tecnico_id || null,
        prioridade: form.prioridade,
        situacao: form.situacao as never,
        previsao: form.previsao || null,
        garantia_dias: Number(form.garantia_dias || 0),
        horas_trabalhadas: Number(form.horas_trabalhadas.replace(",", ".") || 0),
        desconto: Number(form.desconto || 0),
        observacoes: form.observacoes || null,
        entregue_em: form.situacao === "entregue" ? new Date().toISOString() : null,
      };
      if (form.id) {
        const { error } = await supabase.from("os_ordens").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("os_ordens").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(form.id ? "Ordem atualizada." : "Ordem de serviço aberta.");
      setAberto(false);
      setForm(vazio);
      void queryClient.invalidateQueries({ queryKey: ["os-ordens"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const adicionarItem = useMutation({
    mutationFn: async () => {
      if (!profile?.tenant_id || !osAberta) throw new Error("Abra uma ordem de serviço");
      const descricao =
        item.descricao.trim() ||
        produtos.find((p) => p.id === item.produto_id)?.descricao ||
        "";
      if (!descricao) throw new Error("Informe a peça ou o serviço");
      const quantidade = Number(item.quantidade.replace(",", ".") || 0);
      const preco = Number(item.preco.replace(",", ".") || 0);
      if (quantidade <= 0) throw new Error("Quantidade inválida");
      const { error } = await supabase.from("os_itens").insert({
        tenant_id: profile.tenant_id,
        os_id: osAberta,
        tipo: item.tipo,
        produto_id: item.tipo === "peca" ? item.produto_id || null : null,
        descricao,
        quantidade,
        preco_unitario: preco,
        total: Number((quantidade * preco).toFixed(2)),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setItem(itemVazio);
      void queryClient.invalidateQueries({ queryKey: ["os-itens", osAberta] });
      void queryClient.invalidateQueries({ queryKey: ["os-ordens"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removerItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("os_itens").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["os-itens", osAberta] });
      void queryClient.invalidateQueries({ queryKey: ["os-ordens"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const andamento = ordens.filter((o) => !["entregue", "cancelada"].includes(o.situacao));

  return (
    <div>
      <PageHeader
        title="Assistência técnica"
        description="Ordens de serviço do balcão de conserto: equipamento, defeito, peças, mão de obra e entrega."
        actions={
          <Button
            onClick={() => {
              setForm(vazio);
              setAberto(true);
            }}
          >
            <Plus className="size-4" /> Nova ordem
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Ordens em andamento" value={String(andamento.length)} icon={Wrench} />
        <StatCard
          label="Prontas para entrega"
          value={String(ordens.filter((o) => o.situacao === "pronta").length)}
          tone="success"
        />
        <StatCard
          label="Aguardando aprovação"
          value={String(ordens.filter((o) => o.situacao === "orcamento").length)}
          tone="warning"
        />
        <StatCard
          label="Valor em serviço"
          value={brl(andamento.reduce((s, o) => s + Number(o.valor_total ?? 0), 0))}
          icon={ListChecks}
          tone="accent"
        />
      </div>

      <div className="panel mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por número, cliente, equipamento ou série"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <Select value={filtro} onValueChange={setFiltro}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as ordens</SelectItem>
            <SelectItem value="abertas">Somente em andamento</SelectItem>
            {SITUACOES_OS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhuma ordem de serviço."
          description="Abra a primeira ordem para registrar o equipamento e o defeito relatado pelo cliente."
          action={
            <Button
              onClick={() => {
                setForm(vazio);
                setAberto(true);
              }}
            >
              <Plus className="size-4" /> Nova ordem
            </Button>
          }
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Equipamento</TableHead>
                <TableHead>Técnico</TableHead>
                <TableHead>Previsão</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Peças</TableHead>
                <TableHead className="text-right">Serviços</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="text-numeric font-semibold">{o.numero}</TableCell>
                  <TableCell>{o.clientes?.nome ?? "Consumidor"}</TableCell>
                  <TableCell>
                    <p className="font-medium">{o.equipamento}</p>
                    <p className="text-xs text-muted-foreground">
                      {[o.marca, o.modelo, o.numero_serie].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{o.tecnico_nome ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{dateBR(o.previsao)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={o.situacao === "cancelada" ? "outline" : "secondary"}
                      className={
                        o.situacao === "entregue"
                          ? "bg-success/15 text-success"
                          : o.situacao === "pronta"
                            ? "bg-primary/15 text-primary"
                            : undefined
                      }
                    >
                      {rotuloSituacao(o.situacao)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-numeric">{brl(Number(o.valor_pecas ?? 0))}</TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(o.valor_servicos ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric font-semibold">
                    {brl(Number(o.valor_total ?? 0))}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setOsAberta(o.id)}>
                        <ListChecks className="size-4" /> Peças e serviços
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setForm({
                            id: o.id,
                            cliente_id: o.cliente_id ?? "",
                            equipamento: o.equipamento,
                            marca: o.marca ?? "",
                            modelo: o.modelo ?? "",
                            numero_serie: o.numero_serie ?? "",
                            acessorios: o.acessorios ?? "",
                            defeito_relatado: o.defeito_relatado ?? "",
                            diagnostico: o.diagnostico ?? "",
                            laudo: o.laudo ?? "",
                            tecnico_nome: o.tecnico_nome ?? "",
                            tecnico_id: o.tecnico_id ?? "",
                            prioridade: o.prioridade,
                            situacao: o.situacao,
                            previsao: o.previsao ?? "",
                            garantia_dias: String(o.garantia_dias ?? 90),
                            horas_trabalhadas: String(o.horas_trabalhadas ?? 0),
                            desconto: String(o.desconto ?? 0),
                            observacoes: o.observacoes ?? "",
                          });
                          setAberto(true);
                        }}
                      >
                        <Pencil className="size-4" /> Editar
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar ordem de serviço" : "Nova ordem de serviço"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Cliente</Label>
              <ClienteCombobox
                clientes={clientes}
                value={form.cliente_id}
                onChange={(id) => setForm({ ...form, cliente_id: id })}
              />
            </div>
            <div>
              <Label>Equipamento</Label>
              <Input
                value={form.equipamento}
                placeholder="Furadeira de impacto"
                onChange={(e) => setForm({ ...form, equipamento: e.target.value })}
              />
            </div>
            <div>
              <Label>Marca</Label>
              <Input value={form.marca} onChange={(e) => setForm({ ...form, marca: e.target.value })} />
            </div>
            <div>
              <Label>Modelo</Label>
              <Input value={form.modelo} onChange={(e) => setForm({ ...form, modelo: e.target.value })} />
            </div>
            <div>
              <Label>Número de série</Label>
              <Input
                value={form.numero_serie}
                onChange={(e) => setForm({ ...form, numero_serie: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Acessórios entregues</Label>
              <Input
                value={form.acessorios}
                placeholder="Maleta, carregador, 2 baterias"
                onChange={(e) => setForm({ ...form, acessorios: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Defeito relatado pelo cliente</Label>
              <Textarea
                value={form.defeito_relatado}
                onChange={(e) => setForm({ ...form, defeito_relatado: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Diagnóstico técnico</Label>
              <Textarea
                value={form.diagnostico}
                onChange={(e) => setForm({ ...form, diagnostico: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Laudo / serviço executado</Label>
              <Textarea value={form.laudo} onChange={(e) => setForm({ ...form, laudo: e.target.value })} />
            </div>
            <div>
              <Label>Técnico responsável</Label>
              <Select
                value={form.tecnico_id || "sem"}
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    tecnico_id: v === "sem" ? "" : v,
                    tecnico_nome:
                      v === "sem" ? "" : (tecnicos.find((t) => t.id === v)?.nome ?? ""),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sem técnico" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sem">Sem técnico definido</SelectItem>
                  {tecnicos.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.nome}
                      {t.especialidade ? ` · ${t.especialidade}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                Cadastre os técnicos em Assistência técnica › Técnicos.
              </p>
            </div>
            <div>
              <Label>Prioridade</Label>
              <Select value={form.prioridade} onValueChange={(v) => setForm({ ...form, prioridade: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="baixa">Baixa</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="urgente">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Situação</Label>
              <Select value={form.situacao} onValueChange={(v) => setForm({ ...form, situacao: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SITUACOES_OS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Previsão de entrega</Label>
              <Input
                type="date"
                value={form.previsao}
                onChange={(e) => setForm({ ...form, previsao: e.target.value })}
              />
            </div>
            <div>
              <Label>Garantia (dias)</Label>
              <Input
                value={form.garantia_dias}
                onChange={(e) => setForm({ ...form, garantia_dias: e.target.value })}
              />
            </div>
            <div>
              <Label>Horas trabalhadas</Label>
              <Input
                value={form.horas_trabalhadas}
                onChange={(e) => setForm({ ...form, horas_trabalhadas: e.target.value })}
              />
            </div>
            <div>
              <Label>Desconto (R$)</Label>
              <Input
                value={form.desconto}
                onChange={(e) => setForm({ ...form, desconto: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Observações</Label>
              <Input
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

      <Dialog open={!!osAberta} onOpenChange={(v) => !v && setOsAberta(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Peças e serviços — OS {ordem?.numero} · {ordem?.equipamento}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <Label>Tipo</Label>
              <Select value={item.tipo} onValueChange={(v) => setItem({ ...item, tipo: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="peca">Peça</SelectItem>
                  <SelectItem value="servico">Mão de obra</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {item.tipo === "peca" ? (
              <div className="sm:col-span-4">
                <Label>Produto do estoque</Label>
                <Select
                  value={item.produto_id}
                  onValueChange={(v) => {
                    const p = produtos.find((x) => x.id === v);
                    setItem({
                      ...item,
                      produto_id: v,
                      descricao: p?.descricao ?? "",
                      preco: String(p?.preco_venda ?? 0),
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha a peça" />
                  </SelectTrigger>
                  <SelectContent>
                    {produtos.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.descricao}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="sm:col-span-4">
                <Label>Descrição do serviço</Label>
                <Input
                  value={item.descricao}
                  placeholder="Troca de escova e limpeza"
                  onChange={(e) => setItem({ ...item, descricao: e.target.value })}
                />
              </div>
            )}
            <div className="sm:col-span-2">
              <Label>Quantidade</Label>
              <Input
                value={item.quantidade}
                onChange={(e) => setItem({ ...item, quantidade: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Preço unitário</Label>
              <Input value={item.preco} onChange={(e) => setItem({ ...item, preco: e.target.value })} />
            </div>
            <div className="flex items-end sm:col-span-2">
              <Button
                className="w-full"
                onClick={() => adicionarItem.mutate()}
                disabled={adicionarItem.isPending}
              >
                <Plus className="size-4" /> Adicionar
              </Button>
            </div>
          </div>

          {itens.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma peça ou serviço lançado nesta ordem.
            </p>
          ) : (
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
                {itens.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>{i.descricao}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {i.tipo === "peca" ? "Peça" : "Mão de obra"}
                    </TableCell>
                    <TableCell className="text-right text-numeric">
                      {num(Number(i.quantidade), 3)}
                    </TableCell>
                    <TableCell className="text-right text-numeric">
                      {brl(Number(i.preco_unitario))}
                    </TableCell>
                    <TableCell className="text-right text-numeric">{brl(Number(i.total))}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => removerItem.mutate(i.id)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <div className="rounded-md border border-border p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Peças</span>
              <span className="text-numeric">{brl(Number(ordem?.valor_pecas ?? 0))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Mão de obra</span>
              <span className="text-numeric">{brl(Number(ordem?.valor_servicos ?? 0))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Desconto</span>
              <span className="text-numeric">{brl(Number(ordem?.desconto ?? 0))}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold">
              <span>Total da ordem</span>
              <span className="text-numeric">{brl(Number(ordem?.valor_total ?? 0))}</span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOsAberta(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** O módulo só abre quando o CNAE da empresa permite. */
function AssistenciaModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.assistencia) return <ModuloBloqueado modulo="assistencia" />;
  return <Assistencia />;
}
