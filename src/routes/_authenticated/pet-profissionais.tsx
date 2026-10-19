import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Scissors } from "lucide-react";
import { toast } from "sonner";

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
import { FUNCOES_PROFISSIONAL, rotulo } from "@/lib/pet";

export const Route = createFileRoute("/_authenticated/pet-profissionais")({
  head: () => ({
    meta: [
      { title: "Profissionais do pet shop — ERP Ze Tech" },
      {
        name: "description",
        content: "Banhistas, tosadores e demais profissionais, com a comissão de cada um.",
      },
    ],
  }),
  component: ProfissionaisModulo,
});

const SEM_LOJA = "__sem_loja";

type Form = {
  id?: string;
  nome: string;
  funcao: string;
  comissao_percentual: string;
  filial_id: string;
  ativo: boolean;
};

const vazio: Form = {
  nome: "",
  funcao: "tosador",
  comissao_percentual: "0",
  filial_id: "",
  ativo: true,
};

function ProfissionaisModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.petshop) return <ModuloBloqueado modulo="petshop" />;
  return <Profissionais />;
}

function Profissionais() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const filiais = session?.filiais ?? [];
  const podeEditar = (session?.roles ?? []).some((r) => ["administrador", "gestor"].includes(r));
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Form>(vazio);

  const { data: lista = [], isLoading } = useQuery({
    queryKey: ["pet-profissionais"],
    queryFn: async () => {
      const { data, error } = await supabase.from("pet_profissionais").select("*").order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim()) throw new Error("Informe o nome do profissional.");
      const com = Number((form.comissao_percentual || "0").replace(",", "."));
      if (!Number.isFinite(com) || com < 0 || com > 100)
        throw new Error("A comissão precisa ficar entre 0 e 100%.");
      const { error } = await supabase.rpc("pet_profissional_salvar", {
        p_dados: {
          ...(form.id ? { id: form.id } : {}),
          nome: form.nome.trim(),
          funcao: form.funcao,
          comissao_percentual: com,
          filial_id: form.filial_id || null,
          ativo: form.ativo,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(form.id ? "Profissional atualizado." : "Profissional cadastrado.");
      setAberto(false);
      setForm(vazio);
      void qc.invalidateQueries({ queryKey: ["pet-profissionais"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ativos = lista.filter((p) => p.ativo).length;

  return (
    <div>
      <PageHeader
        title="Profissionais do pet shop"
        description="Quem atende os pets. A comissão é paga sobre os serviços feitos por cada um."
        actions={
          podeEditar ? (
            <Button
              onClick={() => {
                setForm(vazio);
                setAberto(true);
              }}
            >
              <Plus className="size-4" /> Novo profissional
            </Button>
          ) : undefined
        }
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <StatCard label="Ativos" value={String(ativos)} icon={Scissors} />
        <StatCard label="Inativos" value={String(lista.length - ativos)} tone="warning" />
      </div>

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhum profissional cadastrado"
          description="Cadastre quem faz banho, tosa e demais serviços."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Função</TableHead>
                <TableHead>Loja</TableHead>
                <TableHead className="text-right">Comissão</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((p) => (
                <TableRow key={p.id} className={p.ativo ? "" : "opacity-60"}>
                  <TableCell className="font-medium">
                    {p.nome}
                    {!p.ativo && (
                      <Badge variant="outline" className="ml-2">
                        Inativo
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{rotulo(FUNCOES_PROFISSIONAL, p.funcao)}</TableCell>
                  <TableCell>
                    {filiais.find((f) => f.id === p.filial_id)?.nome ?? "Todas"}
                  </TableCell>
                  <TableCell className="text-right">{Number(p.comissao_percentual)}%</TableCell>
                  <TableCell className="text-right">
                    {podeEditar && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${p.nome}`}
                        onClick={() => {
                          setForm({
                            id: p.id,
                            nome: p.nome,
                            funcao: p.funcao,
                            comissao_percentual: String(p.comissao_percentual),
                            filial_id: p.filial_id ?? "",
                            ativo: p.ativo,
                          });
                          setAberto(true);
                        }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={aberto} onOpenChange={(o) => !o && setAberto(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar profissional" : "Novo profissional"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label htmlFor="pf-nome">Nome</Label>
              <Input
                id="pf-nome"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pf-funcao">Função</Label>
                <Select value={form.funcao} onValueChange={(v) => setForm({ ...form, funcao: v })}>
                  <SelectTrigger id="pf-funcao">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FUNCOES_PROFISSIONAL.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="pf-com">Comissão (%)</Label>
                <Input
                  id="pf-com"
                  inputMode="decimal"
                  value={form.comissao_percentual}
                  onChange={(e) => setForm({ ...form, comissao_percentual: e.target.value })}
                />
              </div>
            </div>
            {filiais.length > 1 && (
              <div>
                <Label htmlFor="pf-loja">Loja</Label>
                <Select
                  value={form.filial_id || SEM_LOJA}
                  onValueChange={(v) => setForm({ ...form, filial_id: v === SEM_LOJA ? "" : v })}
                >
                  <SelectTrigger id="pf-loja">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_LOJA}>Todas as lojas</SelectItem>
                    {filiais.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch
                id="pf-ativo"
                checked={form.ativo}
                onCheckedChange={(v) => setForm({ ...form, ativo: v })}
              />
              <Label htmlFor="pf-ativo">Ativo</Label>
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
