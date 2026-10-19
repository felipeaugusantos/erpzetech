import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, Pencil, Plus } from "lucide-react";
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
import type { Json } from "@/integrations/supabase/types";
import { useModulosCnae } from "@/lib/cnae";
import { brl, dateBR } from "@/lib/format";
import { VALIDADES_PACOTE, diasParaVencer } from "@/lib/pet";

export const Route = createFileRoute("/_authenticated/pet-pacotes")({
  head: () => ({
    meta: [
      { title: "Pacotes de banho — ERP Ze Tech" },
      {
        name: "description",
        content: "Pacotes de banho vendidos adiantado, com saldo e validade de cada pet.",
      },
    ],
  }),
  component: PacotesModulo,
});

function PacotesModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.petshop) return <ModuloBloqueado modulo="petshop" />;
  return <Pacotes />;
}

type Estado = "ativo" | "esgotado" | "vencido" | "cancelado";
const ROTULO: Record<Estado, string> = {
  ativo: "Ativo",
  esgotado: "Esgotado",
  vencido: "Vencido",
  cancelado: "Cancelado",
};

function Pacotes() {
  const qc = useQueryClient();
  const navegar = useNavigate();
  const { data: session } = useSessionData();
  const roles = session?.roles ?? [];
  const gestao = roles.some((r) => ["administrador", "gestor"].includes(r));
  const podeVender = roles.some((r) =>
    ["administrador", "gestor", "vendedor", "caixa"].includes(r),
  );
  const [mostrar, setMostrar] = useState<"ativos" | "todos">("ativos");
  const [vendendo, setVendendo] = useState(false);
  const [modelos, setModelos] = useState(false);
  const [cancelando, setCancelando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["pet-pacotes"],
    queryFn: async () => {
      const [pacs, usos, mods, pets, clientes, servs] = await Promise.all([
        supabase
          .from("pet_pacotes")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(500),
        supabase.from("pet_pacote_usos").select("pacote_id").eq("desfeito", false),
        supabase.from("pet_pacote_modelos").select("*").order("nome"),
        supabase.from("pets").select("id, nome, ativo, cliente_id").order("nome").limit(2000),
        supabase
          .from("clientes")
          .select("id, nome")
          .is("deleted_at", null)
          .order("nome")
          .limit(2000),
        supabase.from("pet_servicos").select("id, nome, ativo").order("nome"),
      ]);
      for (const r of [pacs, usos, mods, pets, clientes, servs]) if (r.error) throw r.error;
      const usados = new Map<string, number>();
      for (const u of usos.data ?? []) usados.set(u.pacote_id, (usados.get(u.pacote_id) ?? 0) + 1);
      return {
        pacotes: pacs.data ?? [],
        usados,
        modelos: mods.data ?? [],
        pets: pets.data ?? [],
        clientes: clientes.data ?? [],
        servicos: servs.data ?? [],
      };
    },
  });

  const hoje = new Date().toISOString().slice(0, 10);
  const estado = (p: NonNullable<typeof data>["pacotes"][number]): Estado => {
    if (p.situacao === "cancelado") return "cancelado";
    if ((data?.usados.get(p.id) ?? 0) >= p.quantidade) return "esgotado";
    if (p.vence_em < hoje) return "vencido";
    return "ativo";
  };
  const lista = (data?.pacotes ?? []).filter((p) => mostrar === "todos" || estado(p) === "ativo");
  const ativos = (data?.pacotes ?? []).filter((p) => estado(p) === "ativo").length;
  const nomePet = (id: string) => data?.pets.find((p) => p.id === id)?.nome ?? "—";
  const nomeTutor = (id: string) => data?.clientes.find((c) => c.id === id)?.nome ?? "—";
  const nomeModelo = (id: string) => data?.modelos.find((m) => m.id === id)?.nome ?? "—";

  const cancelar = useMutation({
    mutationFn: async () => {
      if (!motivo.trim()) throw new Error("Informe o motivo.");
      const { error } = await supabase.rpc("pet_pacote_cancelar", {
        p_id: cancelando!,
        p_motivo: motivo.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pacote cancelado. O estorno do valor é feito à parte, no caixa.");
      setCancelando(null);
      setMotivo("");
      void qc.invalidateQueries({ queryKey: ["pet-pacotes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Pacotes de banho"
        description="Pacote é de um pet só, vendido adiantado no caixa e válido por 30, 60 ou 90 dias. Cada banho tirado do pacote aparece na retirada do atendimento; no penúltimo, a agenda avisa que resta só mais um."
        actions={
          <>
            {gestao && (
              <Button variant="outline" onClick={() => setModelos(true)}>
                Modelos de pacote
              </Button>
            )}
            {podeVender && (
              <Button onClick={() => setVendendo(true)}>
                <Plus className="size-4" /> Vender pacote
              </Button>
            )}
          </>
        }
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <StatCard label="Pacotes ativos" value={String(ativos)} icon={Package} />
        <StatCard label="No total" value={String((data?.pacotes ?? []).length)} tone="accent" />
      </div>

      <div className="mb-4 w-56">
        <Select value={mostrar} onValueChange={(v) => setMostrar(v as typeof mostrar)}>
          <SelectTrigger aria-label="Quais pacotes mostrar">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ativos">Só os ativos</SelectItem>
            <SelectItem value="todos">Todos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhum pacote aqui"
          description="Venda um pacote escolhendo o pet, o modelo e a validade."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pet</TableHead>
                <TableHead>Tutor</TableHead>
                <TableHead>Pacote</TableHead>
                <TableHead className="text-right">Restam</TableHead>
                <TableHead>Vence</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((p) => {
                const usados = data?.usados.get(p.id) ?? 0;
                const restam = Math.max(p.quantidade - usados, 0);
                const st = estado(p);
                const dias = diasParaVencer(p.vence_em);
                return (
                  <TableRow key={p.id} className={st === "ativo" ? "" : "opacity-60"}>
                    <TableCell className="font-medium">{nomePet(p.pet_id)}</TableCell>
                    <TableCell>{nomeTutor(p.cliente_id)}</TableCell>
                    <TableCell>
                      {nomeModelo(p.modelo_id)}
                      <span className="block text-xs text-muted-foreground">
                        {brl(Number(p.valor))}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <strong className={restam === 1 && st === "ativo" ? "text-amber-700" : ""}>
                        {restam}
                      </strong>{" "}
                      de {p.quantidade}
                    </TableCell>
                    <TableCell>
                      {dateBR(p.vence_em)}
                      {st === "ativo" && dias <= 7 && (
                        <span className="block text-xs text-amber-700">
                          {dias <= 0 ? "vence hoje" : `vence em ${dias} dia(s)`}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={st === "ativo" ? "secondary" : "outline"}>{ROTULO[st]}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {gestao && st !== "cancelado" && (
                        <Button size="sm" variant="outline" onClick={() => setCancelando(p.id)}>
                          Cancelar
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

      {vendendo && data && (
        <VenderDialog
          pets={data.pets.filter((p) => p.ativo)}
          clientes={data.clientes}
          modelos={data.modelos.filter((m) => m.ativo)}
          onFechar={() => setVendendo(false)}
          onIr={(modelo, pet, validade) => {
            setVendendo(false);
            void navegar({ to: "/frente-caixa", search: { pacote: modelo, para: pet, validade } });
          }}
        />
      )}
      {modelos && data && (
        <ModelosDialog
          modelos={data.modelos}
          servicos={data.servicos.filter((s) => s.ativo)}
          onFechar={() => setModelos(false)}
        />
      )}

      <Dialog open={!!cancelando} onOpenChange={(o) => !o && setCancelando(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancelar pacote</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            O pacote deixa de valer. Os banhos já usados continuam registrados e o valor devolvido
            ao tutor, se houver, é tratado à parte no caixa.
          </p>
          <Label htmlFor="pc-motivo">Motivo</Label>
          <Input id="pc-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelando(null)}>
              Voltar
            </Button>
            <Button onClick={() => cancelar.mutate()} disabled={cancelar.isPending}>
              Cancelar o pacote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VenderDialog({
  pets,
  clientes,
  modelos,
  onFechar,
  onIr,
}: {
  pets: { id: string; nome: string; cliente_id: string }[];
  clientes: { id: string; nome: string }[];
  modelos: { id: string; nome: string; quantidade: number; preco: number }[];
  onFechar: () => void;
  onIr: (modelo: string, pet: string, validade: number) => void;
}) {
  const [petId, setPetId] = useState("");
  const [modeloId, setModeloId] = useState("");
  const [validade, setValidade] = useState<string>("60");
  const modelo = modelos.find((m) => m.id === modeloId);
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Vender pacote de banhos</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label htmlFor="vp-pet">Pet (o pacote é só dele)</Label>
            <Select value={petId} onValueChange={setPetId}>
              <SelectTrigger id="vp-pet">
                <SelectValue placeholder="Escolha o pet" />
              </SelectTrigger>
              <SelectContent>
                {pets.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nome} ({clientes.find((c) => c.id === p.cliente_id)?.nome ?? "tutor"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="vp-modelo">Pacote</Label>
            <Select value={modeloId} onValueChange={setModeloId}>
              <SelectTrigger id="vp-modelo">
                <SelectValue placeholder="Escolha o pacote" />
              </SelectTrigger>
              <SelectContent>
                {modelos.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.nome} — {m.quantidade} banhos, {brl(Number(m.preco))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {modelos.length === 0 && (
              <p className="mt-1 text-xs text-destructive">
                Nenhum modelo de pacote ativo. A gestão cadastra em &quot;Modelos de pacote&quot;.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="vp-validade">Validade</Label>
            <Select value={validade} onValueChange={setValidade}>
              <SelectTrigger id="vp-validade">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VALIDADES_PACOTE.map((v) => (
                  <SelectItem key={v} value={String(v)}>
                    {v} dias
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {modelo && (
            <p className="text-sm">
              Total <strong>{brl(Number(modelo.preco))}</strong> — o pagamento é escolhido na frente
              de caixa.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={!petId || !modeloId}
            onClick={() => onIr(modeloId, petId, Number(validade))}
          >
            Ir para o caixa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type FormModelo = {
  id?: string;
  nome: string;
  servico_id: string;
  quantidade: string;
  preco: string;
  ativo: boolean;
};
const modeloVazio: FormModelo = {
  nome: "",
  servico_id: "",
  quantidade: "4",
  preco: "",
  ativo: true,
};

function ModelosDialog({
  modelos,
  servicos,
  onFechar,
}: {
  modelos: {
    id: string;
    nome: string;
    servico_id: string;
    quantidade: number;
    preco: number;
    ativo: boolean;
  }[];
  servicos: { id: string; nome: string }[];
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormModelo>(modeloVazio);
  const nomeServico = useMemo(
    () => (id: string) => servicos.find((s) => s.id === id)?.nome ?? "—",
    [servicos],
  );
  const salvar = useMutation({
    mutationFn: async () => {
      const qtd = Number(form.quantidade);
      const preco = Number(form.preco.replace(",", "."));
      if (!form.nome.trim()) throw new Error("Informe o nome do pacote.");
      if (!form.servico_id) throw new Error("Escolha o serviço do pacote.");
      if (!Number.isInteger(qtd) || qtd < 2 || qtd > 52) throw new Error("Use de 2 a 52 serviços.");
      if (!Number.isFinite(preco) || preco <= 0) throw new Error("Informe o preço do pacote.");
      const { error } = await supabase.rpc("pet_pacote_modelo_salvar", {
        p_dados: {
          ...(form.id ? { id: form.id } : {}),
          nome: form.nome.trim(),
          servico_id: form.servico_id,
          quantidade: qtd,
          preco,
          ativo: form.ativo,
        } as unknown as Json,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Modelo salvo.");
      setForm(modeloVazio);
      void qc.invalidateQueries({ queryKey: ["pet-pacotes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Modelos de pacote</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Mudar um modelo vale só para as próximas vendas; pacotes já vendidos guardam o que foi
          combinado.
        </p>
        {modelos.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pacote</TableHead>
                <TableHead>Serviço</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Preço</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {modelos.map((m) => (
                <TableRow key={m.id} className={m.ativo ? "" : "opacity-60"}>
                  <TableCell>{m.nome}</TableCell>
                  <TableCell>{nomeServico(m.servico_id)}</TableCell>
                  <TableCell className="text-right">{m.quantidade}</TableCell>
                  <TableCell className="text-right">{brl(Number(m.preco))}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar ${m.nome}`}
                      onClick={() =>
                        setForm({
                          id: m.id,
                          nome: m.nome,
                          servico_id: m.servico_id,
                          quantidade: String(m.quantidade),
                          preco: String(m.preco),
                          ativo: m.ativo,
                        })
                      }
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="grid gap-3 rounded border p-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="md-nome">{form.id ? "Editar pacote" : "Novo pacote"}</Label>
            <Input
              id="md-nome"
              value={form.nome}
              placeholder="Ex.: Pacote 4 banhos"
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="md-serv">Serviço</Label>
            <Select
              value={form.servico_id}
              onValueChange={(v) => setForm({ ...form, servico_id: v })}
            >
              <SelectTrigger id="md-serv">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                {servicos.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="md-qtd">Quantidade</Label>
              <Input
                id="md-qtd"
                inputMode="numeric"
                value={form.quantidade}
                onChange={(e) => setForm({ ...form, quantidade: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="md-preco">Preço (R$)</Label>
              <Input
                id="md-preco"
                inputMode="decimal"
                value={form.preco}
                onChange={(e) => setForm({ ...form, preco: e.target.value })}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="md-ativo"
              checked={form.ativo}
              onCheckedChange={(v) => setForm({ ...form, ativo: v })}
            />
            <Label htmlFor="md-ativo">À venda</Label>
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            {form.id && (
              <Button variant="outline" onClick={() => setForm(modeloVazio)}>
                Novo
              </Button>
            )}
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              Salvar modelo
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
