import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import {
  TIPOS_VEICULO,
  ehAeronave,
  formatarIdentificacao,
  identificacaoValida,
  mensagemIdentificacao,
  normalizarIdentificacao,
  rotuloTipo,
} from "@/lib/lava-rapido";

export const Route = createFileRoute("/_authenticated/lava-veiculos")({
  head: () => ({
    meta: [
      { title: "Veículos do lava rápido — ERP Ze Tech" },
      {
        name: "description",
        content: "Carros, motos, caminhonetes, aviões e helicópteros atendidos no lava rápido.",
      },
    ],
  }),
  component: VeiculosModulo,
});

type Form = {
  id?: string;
  cliente_id: string;
  tipo: string;
  identificacao: string;
  descricao: string;
  cor: string;
  observacoes: string;
  ativo: boolean;
};

const vazio: Form = {
  cliente_id: "",
  tipo: "carro",
  identificacao: "",
  descricao: "",
  cor: "",
  observacoes: "",
  ativo: true,
};

function VeiculosModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.lavarapido) return <ModuloBloqueado modulo="lavarapido" />;
  return <Veiculos />;
}

function Veiculos() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Form>(vazio);

  const { data, isLoading } = useQuery({
    queryKey: ["lava-veiculos"],
    queryFn: async () => {
      const [veiculos, clientes] = await Promise.all([
        supabase.from("lr_veiculos").select("*").order("identificacao"),
        supabase.from("clientes").select("id, nome").order("nome").limit(2000),
      ]);
      if (veiculos.error) throw veiculos.error;
      if (clientes.error) throw clientes.error;
      return { veiculos: veiculos.data ?? [], clientes: clientes.data ?? [] };
    },
  });
  const clientes = data?.clientes ?? [];
  const nomeCliente = (id: string) => clientes.find((c) => c.id === id)?.nome ?? "—";

  const lista = useMemo(() => {
    const t = normalizarIdentificacao(busca);
    const texto = busca.trim().toLowerCase();
    return (data?.veiculos ?? []).filter(
      (v) =>
        !texto ||
        (t && v.identificacao.includes(t)) ||
        (v.descricao ?? "").toLowerCase().includes(texto) ||
        nomeCliente(v.cliente_id).toLowerCase().includes(texto),
    );
  }, [data, busca]); // eslint-disable-line react-hooks/exhaustive-deps

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.cliente_id) throw new Error("Escolha o cliente dono do veículo.");
      if (!identificacaoValida(form.tipo, form.identificacao))
        throw new Error(mensagemIdentificacao(form.tipo));
      const { error } = await supabase.rpc("lr_veiculo_salvar", {
        p_dados: {
          ...(form.id ? { id: form.id } : {}),
          cliente_id: form.cliente_id,
          tipo: form.tipo,
          identificacao: normalizarIdentificacao(form.identificacao),
          descricao: form.descricao,
          cor: form.cor,
          observacoes: form.observacoes,
          ativo: form.ativo,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(form.id ? "Veículo atualizado." : "Veículo cadastrado.");
      setAberto(false);
      setForm(vazio);
      void qc.invalidateQueries({ queryKey: ["lava-veiculos"] });
      void qc.invalidateQueries({ queryKey: ["lava-patio"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Veículos"
        description="Carro, moto, caminhonete, avião e helicóptero. Terrestres levam a placa; aeronaves, o prefixo."
        actions={
          <Button
            onClick={() => {
              setForm(vazio);
              setAberto(true);
            }}
          >
            <Plus className="size-4" /> Novo veículo
          </Button>
        }
      />

      <div className="mb-4 max-w-sm">
        <Input
          aria-label="Buscar veículo"
          placeholder="Buscar por placa, prefixo, modelo ou cliente"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhum veículo encontrado"
          description="Cadastre o veículo do cliente para abrir a ordem de lavagem."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Placa / prefixo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((v) => (
                <TableRow key={v.id} className={v.ativo ? "" : "opacity-60"}>
                  <TableCell className="font-medium">
                    {formatarIdentificacao(v.tipo, v.identificacao)}
                    {!v.ativo && (
                      <Badge variant="outline" className="ml-2">
                        Inativo
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{rotuloTipo(v.tipo)}</TableCell>
                  <TableCell>{[v.descricao, v.cor].filter(Boolean).join(" · ") || "—"}</TableCell>
                  <TableCell>{nomeCliente(v.cliente_id)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar ${v.identificacao}`}
                      onClick={() => {
                        setForm({
                          id: v.id,
                          cliente_id: v.cliente_id,
                          tipo: v.tipo,
                          identificacao: formatarIdentificacao(v.tipo, v.identificacao),
                          descricao: v.descricao ?? "",
                          cor: v.cor ?? "",
                          observacoes: v.observacoes ?? "",
                          ativo: v.ativo,
                        });
                        setAberto(true);
                      }}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={aberto} onOpenChange={(o) => !o && setAberto(false)}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar veículo" : "Novo veículo"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label htmlFor="vc-cliente">Cliente</Label>
              <Select
                value={form.cliente_id}
                onValueChange={(v) => setForm({ ...form, cliente_id: v })}
              >
                <SelectTrigger id="vc-cliente">
                  <SelectValue placeholder="Escolha o cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clientes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="vc-tipo">Tipo</Label>
                <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                  <SelectTrigger id="vc-tipo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS_VEICULO.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="vc-ident">{ehAeronave(form.tipo) ? "Prefixo" : "Placa"}</Label>
                <Input
                  id="vc-ident"
                  value={form.identificacao}
                  placeholder={ehAeronave(form.tipo) ? "PT-ABC" : "ABC-1D23"}
                  onChange={(e) =>
                    setForm({ ...form, identificacao: e.target.value.toUpperCase() })
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="vc-desc">Marca / modelo</Label>
                <Input
                  id="vc-desc"
                  value={form.descricao}
                  onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="vc-cor">Cor</Label>
                <Input
                  id="vc-cor"
                  value={form.cor}
                  onChange={(e) => setForm({ ...form, cor: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="vc-obs">Observações</Label>
              <Textarea
                id="vc-obs"
                rows={2}
                value={form.observacoes}
                onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="vc-ativo"
                checked={form.ativo}
                onCheckedChange={(v) => setForm({ ...form, ativo: v })}
              />
              <Label htmlFor="vc-ativo">Ativo</Label>
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
