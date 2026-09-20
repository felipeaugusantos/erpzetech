import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hammer, Pencil, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { useSessionData } from "@/hooks/useSessionData";
import { brl } from "@/lib/format";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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

export const Route = createFileRoute("/_authenticated/locacao-equipamentos")({
  head: () => ({
    meta: [
      { title: "Equipamentos para locação — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Cadastro dos equipamentos de locação: valores de diária, semana e mês, caução e disponibilidade.",
      },
      { property: "og:title", content: "Equipamentos para locação — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Controle o que está disponível, locado ou em manutenção.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EquipamentosModulo,
});

export const SITUACOES_EQUIP = [
  { value: "disponivel", label: "Disponível" },
  { value: "locado", label: "Locado" },
  { value: "manutencao", label: "Em manutenção" },
  { value: "inativo", label: "Inativo" },
];

type Form = {
  id?: string;
  codigo: string;
  nome: string;
  categoria: string;
  marca: string;
  modelo: string;
  numero_serie: string;
  quantidade: string;
  valor_diaria: string;
  valor_semanal: string;
  valor_mensal: string;
  valor_caucao: string;
  valor_aquisicao: string;
  custo_manutencao: string;
  situacao: string;
  observacoes: string;
  ativo: boolean;
};

const vazio: Form = {
  codigo: "",
  nome: "",
  categoria: "",
  marca: "",
  modelo: "",
  numero_serie: "",
  quantidade: "1",
  valor_diaria: "0",
  valor_semanal: "0",
  valor_mensal: "0",
  valor_caucao: "0",
  valor_aquisicao: "0",
  custo_manutencao: "0",
  situacao: "disponivel",
  observacoes: "",
  ativo: true,
};

function Equipamentos() {
  const { data: session } = useSessionData();
  const profile = session?.profile;
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Form>(vazio);

  const { data: equipamentos = [], isLoading } = useQuery({
    queryKey: ["locacao-equipamentos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locacao_equipamentos")
        .select("*")
        .order("nome");
      if (error) throw error;
      return data;
    },
  });

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return equipamentos;
    return equipamentos.filter((e) =>
      [e.nome, e.codigo, e.categoria, e.marca, e.modelo, e.numero_serie]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(t)),
    );
  }, [equipamentos, busca]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!profile?.tenant_id) throw new Error("Usuário sem empresa vinculada");
      if (!form.nome.trim()) throw new Error("Informe o nome do equipamento");
      const payload = {
        tenant_id: profile.tenant_id,
        filial_id: profile.filial_id ?? null,
        codigo: form.codigo || null,
        nome: form.nome.trim(),
        categoria: form.categoria || null,
        marca: form.marca || null,
        modelo: form.modelo || null,
        numero_serie: form.numero_serie || null,
        quantidade: Math.max(Number(form.quantidade.replace(",", ".") || 1), 0),
        valor_diaria: Number(form.valor_diaria.replace(",", ".") || 0),
        valor_semanal: Number(form.valor_semanal.replace(",", ".") || 0),
        valor_mensal: Number(form.valor_mensal.replace(",", ".") || 0),
        valor_caucao: Number(form.valor_caucao.replace(",", ".") || 0),
        valor_aquisicao: Number(form.valor_aquisicao.replace(",", ".") || 0),
        custo_manutencao: Number(form.custo_manutencao.replace(",", ".") || 0),
        situacao: form.situacao,
        observacoes: form.observacoes || null,
        ativo: form.ativo,
      };
      if (form.id) {
        const { error } = await supabase
          .from("locacao_equipamentos")
          .update(payload)
          .eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("locacao_equipamentos").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(form.id ? "Equipamento atualizado." : "Equipamento cadastrado.");
      setAberto(false);
      setForm(vazio);
      void queryClient.invalidateQueries({ queryKey: ["locacao-equipamentos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Equipamentos para locação"
        description="O que a loja aluga: valores por diária, semana e mês, caução e disponibilidade."
        actions={
          <Button
            onClick={() => {
              setForm(vazio);
              setAberto(true);
            }}
          >
            <Plus className="size-4" /> Novo equipamento
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Equipamentos" value={String(equipamentos.length)} icon={Hammer} />
        <StatCard
          label="Disponíveis"
          value={String(equipamentos.filter((e) => e.ativo && e.situacao === "disponivel").length)}
          tone="success"
        />
        <StatCard
          label="Locados agora"
          value={String(equipamentos.filter((e) => e.situacao === "locado").length)}
          tone="accent"
        />
        <StatCard
          label="Em manutenção"
          value={String(equipamentos.filter((e) => e.situacao === "manutencao").length)}
          tone="warning"
        />
      </div>

      <div className="panel mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome, código, categoria ou série"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhum equipamento cadastrado."
          description="Cadastre betoneiras, andaimes, marteletes e o que mais a loja alugar."
          action={
            <Button
              onClick={() => {
                setForm(vazio);
                setAberto(true);
              }}
            >
              <Plus className="size-4" /> Novo equipamento
            </Button>
          }
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Equipamento</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">Estoque</TableHead>
                <TableHead className="text-right">Diária</TableHead>
                <TableHead className="text-right">Semana</TableHead>
                <TableHead className="text-right">Mês</TableHead>
                <TableHead className="text-right">Caução</TableHead>
                <TableHead className="text-right">Aquisição</TableHead>
                <TableHead className="text-right">Manutenção</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <p className="font-medium">{e.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {[e.marca, e.modelo, e.numero_serie].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </TableCell>
                  <TableCell className="text-numeric">{e.codigo ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{e.categoria ?? "—"}</TableCell>
                  <TableCell className="text-right text-numeric">{Number(e.quantidade ?? 1)}</TableCell>
                  <TableCell className="text-right text-numeric">{brl(Number(e.valor_diaria))}</TableCell>
                  <TableCell className="text-right text-numeric">{brl(Number(e.valor_semanal))}</TableCell>
                  <TableCell className="text-right text-numeric">{brl(Number(e.valor_mensal))}</TableCell>
                  <TableCell className="text-right text-numeric">{brl(Number(e.valor_caucao))}</TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(e.valor_aquisicao ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(e.custo_manutencao ?? 0))}
                  </TableCell>
                  <TableCell>
                    {!e.ativo ? (
                      <Badge variant="outline">Inativo</Badge>
                    ) : (
                      <Badge
                        className={
                          e.situacao === "disponivel"
                            ? "bg-success/15 text-success"
                            : e.situacao === "locado"
                              ? "bg-primary/15 text-primary"
                              : undefined
                        }
                        variant={e.situacao === "manutencao" ? "secondary" : "default"}
                      >
                        {SITUACOES_EQUIP.find((s) => s.value === e.situacao)?.label ?? e.situacao}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setForm({
                          id: e.id,
                          codigo: e.codigo ?? "",
                          nome: e.nome,
                          categoria: e.categoria ?? "",
                          marca: e.marca ?? "",
                          modelo: e.modelo ?? "",
                          numero_serie: e.numero_serie ?? "",
                          quantidade: String(e.quantidade ?? 1),
                          valor_diaria: String(e.valor_diaria ?? 0),
                          valor_semanal: String(e.valor_semanal ?? 0),
                          valor_mensal: String(e.valor_mensal ?? 0),
                          valor_caucao: String(e.valor_caucao ?? 0),
                          valor_aquisicao: String(e.valor_aquisicao ?? 0),
                          custo_manutencao: String(e.custo_manutencao ?? 0),
                          situacao: e.situacao,
                          observacoes: e.observacoes ?? "",
                          ativo: e.ativo,
                        });
                        setAberto(true);
                      }}
                    >
                      <Pencil className="size-4" /> Editar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar equipamento" : "Novo equipamento"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Nome</Label>
              <Input
                value={form.nome}
                placeholder="Betoneira 400 litros"
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div>
              <Label>Código</Label>
              <Input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
            </div>
            <div>
              <Label>Categoria</Label>
              <Input
                value={form.categoria}
                placeholder="Concretagem"
                onChange={(e) => setForm({ ...form, categoria: e.target.value })}
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
            <div>
              <Label>Quantidade em estoque</Label>
              <Input
                value={form.quantidade}
                onChange={(e) => setForm({ ...form, quantidade: e.target.value })}
              />
            </div>
            <div>
              <Label>Situação</Label>
              <Select value={form.situacao} onValueChange={(v) => setForm({ ...form, situacao: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SITUACOES_EQUIP.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Valor da diária</Label>
              <Input
                value={form.valor_diaria}
                onChange={(e) => setForm({ ...form, valor_diaria: e.target.value })}
              />
            </div>
            <div>
              <Label>Valor da semana</Label>
              <Input
                value={form.valor_semanal}
                onChange={(e) => setForm({ ...form, valor_semanal: e.target.value })}
              />
            </div>
            <div>
              <Label>Valor do mês</Label>
              <Input
                value={form.valor_mensal}
                onChange={(e) => setForm({ ...form, valor_mensal: e.target.value })}
              />
            </div>
            <div>
              <Label>Caução</Label>
              <Input
                value={form.valor_caucao}
                onChange={(e) => setForm({ ...form, valor_caucao: e.target.value })}
              />
            </div>
            <div>
              <Label>Valor de aquisição</Label>
              <Input
                value={form.valor_aquisicao}
                onChange={(e) => setForm({ ...form, valor_aquisicao: e.target.value })}
              />
            </div>
            <div>
              <Label>Custo de manutenção</Label>
              <Input
                value={form.custo_manutencao}
                onChange={(e) => setForm({ ...form, custo_manutencao: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Observações</Label>
              <Input
                value={form.observacoes}
                onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Switch checked={form.ativo} onCheckedChange={(v) => setForm({ ...form, ativo: v })} />
              <span className="text-sm">Equipamento ativo</span>
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
    </div>
  );
}

/** O módulo só abre quando o CNAE da empresa permite. */
function EquipamentosModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.locacao) return <ModuloBloqueado modulo="locacao" />;
  return <Equipamentos />;
}
