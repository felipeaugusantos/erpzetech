import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
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
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { brl } from "@/lib/format";
import { CATEGORIAS_SERVICO, TIPOS_VEICULO, rotuloCategoria, rotuloTipo } from "@/lib/lava-rapido";

export const Route = createFileRoute("/_authenticated/lava-servicos")({
  head: () => ({
    meta: [
      { title: "Serviços e preços do lava rápido — ERP Ze Tech" },
      {
        name: "description",
        content: "Serviços de lavagem, polimento e higienização, com preço por tipo de veículo.",
      },
    ],
  }),
  component: ServicosModulo,
});

const QUALQUER = "__qualquer";

type FormServico = {
  id?: string;
  nome: string;
  categoria: string;
  duracao_min: string;
  preco_base: string;
  ativo: boolean;
};

const vazio: FormServico = {
  nome: "",
  categoria: "lavagem",
  duracao_min: "30",
  preco_base: "0",
  ativo: true,
};

function ServicosModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.lavarapido) return <ModuloBloqueado modulo="lavarapido" />;
  return <Servicos />;
}

function Servicos() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const podeEditar = (session?.roles ?? []).some((r) => ["administrador", "gestor"].includes(r));
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<FormServico>(vazio);
  const [precosDe, setPrecosDe] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["lava-servicos"],
    queryFn: async () => {
      const [servicos, produtos, precos] = await Promise.all([
        supabase.from("lr_servicos").select("*").order("nome"),
        supabase.from("produtos").select("id, preco_venda").eq("controla_estoque", false),
        supabase.from("lr_servico_precos").select("*"),
      ]);
      if (servicos.error) throw servicos.error;
      if (produtos.error) throw produtos.error;
      if (precos.error) throw precos.error;
      return {
        servicos: servicos.data ?? [],
        produtos: produtos.data ?? [],
        precos: precos.data ?? [],
      };
    },
  });
  const servicos = data?.servicos ?? [];
  const precoBalcao = (produtoId: string) =>
    Number(data?.produtos.find((p) => p.id === produtoId)?.preco_venda ?? 0);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim()) throw new Error("Informe o nome do serviço.");
      const dur = Number(form.duracao_min);
      if (!Number.isInteger(dur) || dur < 5 || dur > 1440)
        throw new Error("A duração precisa ficar entre 5 e 1440 minutos.");
      const base = Number((form.preco_base || "0").replace(",", "."));
      if (!Number.isFinite(base) || base < 0) throw new Error("Informe um preço válido.");
      const { error } = await supabase.rpc("lr_servico_salvar", {
        p_dados: {
          ...(form.id ? { id: form.id } : {}),
          nome: form.nome.trim(),
          categoria: form.categoria,
          duracao_min: dur,
          preco_base: base,
          ativo: form.ativo,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(form.id ? "Serviço atualizado." : "Serviço cadastrado.");
      setAberto(false);
      setForm(vazio);
      void qc.invalidateQueries({ queryKey: ["lava-servicos"] });
      void qc.invalidateQueries({ queryKey: ["lava-patio"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Serviços e preços"
        description="Cada serviço aparece na frente de caixa como item sem estoque. O preço varia pelo tipo do veículo."
        actions={
          podeEditar ? (
            <Button
              onClick={() => {
                setForm(vazio);
                setAberto(true);
              }}
            >
              <Plus className="size-4" /> Novo serviço
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : servicos.length === 0 ? (
        <EmptyState
          title="Nenhum serviço cadastrado"
          description="Cadastre lavagem simples, completa, polimento e demais serviços e depois defina os preços por tipo de veículo."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Serviço</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">Duração</TableHead>
                <TableHead className="text-right">Preço de balcão</TableHead>
                <TableHead className="text-right">Preços por tipo</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {servicos.map((s) => {
                const qtd = (data?.precos ?? []).filter((p) => p.servico_id === s.id).length;
                return (
                  <TableRow key={s.id} className={s.ativo ? "" : "opacity-60"}>
                    <TableCell className="font-medium">
                      {s.nome}
                      {!s.ativo && (
                        <Badge variant="outline" className="ml-2">
                          Inativo
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{rotuloCategoria(s.categoria)}</TableCell>
                    <TableCell className="text-right">{s.duracao_min} min</TableCell>
                    <TableCell className="text-right">{brl(precoBalcao(s.produto_id))}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setPrecosDe(s.id)}>
                        <Tag className="size-4" /> {qtd} {qtd === 1 ? "preço" : "preços"}
                      </Button>
                    </TableCell>
                    <TableCell className="text-right">
                      {podeEditar && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Editar ${s.nome}`}
                          onClick={() => {
                            setForm({
                              id: s.id,
                              nome: s.nome,
                              categoria: s.categoria,
                              duracao_min: String(s.duracao_min),
                              preco_base: String(precoBalcao(s.produto_id)),
                              ativo: s.ativo,
                            });
                            setAberto(true);
                          }}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={aberto} onOpenChange={(o) => !o && setAberto(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar serviço" : "Novo serviço"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label htmlFor="sv-nome">Nome</Label>
              <Input
                id="sv-nome"
                value={form.nome}
                placeholder="Ex.: Lavagem completa, Polimento"
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="sv-cat">Categoria</Label>
                <Select
                  value={form.categoria}
                  onValueChange={(v) => setForm({ ...form, categoria: v })}
                >
                  <SelectTrigger id="sv-cat">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIAS_SERVICO.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="sv-dur">Duração (min)</Label>
                <Input
                  id="sv-dur"
                  inputMode="numeric"
                  value={form.duracao_min}
                  onChange={(e) => setForm({ ...form, duracao_min: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="sv-base">Preço de balcão (R$)</Label>
              <Input
                id="sv-base"
                inputMode="decimal"
                value={form.preco_base}
                onChange={(e) => setForm({ ...form, preco_base: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Vale quando não há preço para o tipo do veículo. Os preços por tipo (carro, moto,
                caminhonete, avião, helicóptero) são definidos em &quot;preços&quot;.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="sv-ativo"
                checked={form.ativo}
                onCheckedChange={(v) => setForm({ ...form, ativo: v })}
              />
              <Label htmlFor="sv-ativo">Ativo</Label>
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

      {precosDe && (
        <PrecosDialog
          servico={servicos.find((s) => s.id === precosDe) ?? null}
          precos={(data?.precos ?? []).filter((p) => p.servico_id === precosDe)}
          podeEditar={podeEditar}
          onFechar={() => setPrecosDe(null)}
        />
      )}
    </div>
  );
}

type PrecoLinha = { id: string; tipo: string | null; preco: number };

function PrecosDialog({
  servico,
  precos,
  podeEditar,
  onFechar,
}: {
  servico: { id: string; nome: string } | null;
  precos: PrecoLinha[];
  podeEditar: boolean;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const [tipo, setTipo] = useState("");
  const [valor, setValor] = useState("");

  const ordenados = [...precos]
    .map((p) => ({ ...p, preco: Number(p.preco) }))
    // "qualquer veículo" primeiro, depois na ordem dos tipos
    .sort(
      (a, b) =>
        TIPOS_VEICULO.findIndex((t) => t.value === a.tipo) -
        TIPOS_VEICULO.findIndex((t) => t.value === b.tipo),
    );

  const gravar = useMutation({
    mutationFn: async () => {
      const preco = Number(valor.replace(",", "."));
      if (!Number.isFinite(preco) || preco < 0 || valor.trim() === "")
        throw new Error("Informe o preço.");
      const { error } = await supabase.rpc("lr_preco_salvar", {
        p_servico_id: servico!.id,
        p_tipo: tipo,
        p_preco: preco,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Preço salvo.");
      setValor("");
      void qc.invalidateQueries({ queryKey: ["lava-servicos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("lr_preco_remover", { p_preco_id: id });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["lava-servicos"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Preços — {servico?.nome}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Vale o preço do tipo do veículo. Sem ele, vale o de &quot;Qualquer veículo&quot; e, por
          último, o preço de balcão. Mudar o preço não altera ordens já abertas.
        </p>

        {ordenados.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nenhum preço por tipo cadastrado ainda.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vale para</TableHead>
                <TableHead className="text-right">Preço</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordenados.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{rotuloTipo(p.tipo)}</TableCell>
                  <TableCell className="text-right">{brl(p.preco)}</TableCell>
                  <TableCell className="text-right">
                    {podeEditar && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remover preço de ${rotuloTipo(p.tipo)}`}
                        onClick={() => remover.mutate(p.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {podeEditar && (
          <div className="grid grid-cols-[1fr_8rem_auto] items-end gap-3">
            <div>
              <Label htmlFor="pr-tipo">Tipo de veículo</Label>
              <Select
                value={tipo || QUALQUER}
                onValueChange={(v) => setTipo(v === QUALQUER ? "" : v)}
              >
                <SelectTrigger id="pr-tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={QUALQUER}>Qualquer veículo</SelectItem>
                  {TIPOS_VEICULO.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="pr-valor">Preço (R$)</Label>
              <Input
                id="pr-valor"
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
            </div>
            <Button onClick={() => gravar.mutate()} disabled={gravar.isPending}>
              Salvar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
