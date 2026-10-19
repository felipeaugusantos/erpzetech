import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PawPrint, Pencil, Plus, Search, Syringe } from "lucide-react";
import { toast } from "sonner";

import { ClienteCombobox } from "@/components/app/ClienteCombobox";
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
import { Textarea } from "@/components/ui/textarea";
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { dateBR } from "@/lib/format";
import { ESPECIES, PELAGENS, PORTES, SEXOS, idadeDoPet, rotulo } from "@/lib/pet";

export const Route = createFileRoute("/_authenticated/pets")({
  head: () => ({
    meta: [
      { title: "Pets e tutores — ERP Ze Tech" },
      {
        name: "description",
        content: "Cadastro dos pets e de seus tutores: espécie, raça, porte, pelagem e alergias.",
      },
    ],
  }),
  component: PetsModulo,
});

const NENHUM = "__nenhum";

type Form = {
  id?: string;
  cliente_id: string;
  nome: string;
  especie: string;
  raca: string;
  porte: string;
  sexo: string;
  pelagem: string;
  peso_kg: string;
  nascimento: string;
  castrado: boolean;
  alergias: string;
  observacoes: string;
  ativo: boolean;
};

const vazio: Form = {
  cliente_id: "",
  nome: "",
  especie: "cao",
  raca: "",
  porte: "",
  sexo: "",
  pelagem: "",
  peso_kg: "",
  nascimento: "",
  castrado: false,
  alergias: "",
  observacoes: "",
  ativo: true,
};

function PetsModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.petshop) return <ModuloBloqueado modulo="petshop" />;
  return <Pets />;
}

function Pets() {
  const qc = useQueryClient();
  const { clinica } = useModulosCnae();
  const { data: session } = useSessionData();
  const podeEditar = (session?.roles ?? []).some((r) =>
    ["administrador", "gestor", "vendedor", "caixa"].includes(r),
  );
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Form>(vazio);

  const { data, isLoading } = useQuery({
    queryKey: ["pets"],
    queryFn: async () => {
      const [pets, clientes] = await Promise.all([
        supabase.from("pets").select("*").order("nome"),
        supabase
          .from("clientes")
          .select("id, nome, cpf, cnpj, telefone")
          .is("deleted_at", null)
          .order("nome")
          .limit(2000),
      ]);
      if (pets.error) throw pets.error;
      if (clientes.error) throw clientes.error;
      return { pets: pets.data ?? [], clientes: clientes.data ?? [] };
    },
  });
  const pets = data?.pets ?? [];
  const clientes = data?.clientes ?? [];
  const tutor = (id: string) => clientes.find((c) => c.id === id);

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return pets;
    return pets.filter((p) => {
      const c = tutor(p.cliente_id);
      return [p.nome, p.raca, c?.nome, c?.telefone]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(t));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pets, clientes, busca]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.cliente_id) throw new Error("Escolha o tutor (cliente) do pet.");
      if (!form.nome.trim()) throw new Error("Informe o nome do pet.");
      const peso = form.peso_kg.trim() ? Number(form.peso_kg.replace(",", ".")) : null;
      if (peso !== null && (!Number.isFinite(peso) || peso <= 0))
        throw new Error("Informe um peso válido.");
      const { error } = await supabase.rpc("pet_salvar", {
        p_dados: {
          ...(form.id ? { id: form.id } : {}),
          cliente_id: form.cliente_id,
          nome: form.nome.trim(),
          especie: form.especie,
          raca: form.raca.trim() || null,
          porte: form.porte || null,
          sexo: form.sexo || null,
          pelagem: form.pelagem || null,
          peso_kg: peso,
          nascimento: form.nascimento || null,
          castrado: form.castrado,
          alergias: form.alergias.trim() || null,
          observacoes: form.observacoes.trim() || null,
          ativo: form.ativo,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(form.id ? "Pet atualizado." : "Pet cadastrado.");
      setAberto(false);
      setForm(vazio);
      void qc.invalidateQueries({ queryKey: ["pets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ativos = pets.filter((p) => p.ativo).length;
  const sel = (
    valor: string,
    onChange: (v: string) => void,
    opcoes: typeof PORTES | typeof PELAGENS | typeof SEXOS | typeof ESPECIES,
    nenhum: boolean,
    id: string,
  ) => (
    <Select value={valor || NENHUM} onValueChange={(v) => onChange(v === NENHUM ? "" : v)}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {nenhum && <SelectItem value={NENHUM}>Não informado</SelectItem>}
        {opcoes.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div>
      <PageHeader
        title="Pets e tutores"
        description="Cada pet pertence a um tutor (cliente). Porte, raça e pelagem definem o preço dos serviços."
        actions={
          podeEditar ? (
            <Button
              onClick={() => {
                setForm(vazio);
                setAberto(true);
              }}
            >
              <Plus className="size-4" /> Novo pet
            </Button>
          ) : undefined
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <StatCard label="Pets ativos" value={String(ativos)} icon={PawPrint} />
        <StatCard label="Inativos" value={String(pets.length - ativos)} tone="warning" />
      </div>

      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Buscar por pet, raça, tutor ou telefone"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : lista.length === 0 ? (
        <EmptyState
          title={pets.length === 0 ? "Nenhum pet cadastrado" : "Nada encontrado"}
          description={
            pets.length === 0
              ? "Cadastre o primeiro pet escolhendo o tutor."
              : "Tente outro termo de busca."
          }
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pet</TableHead>
                <TableHead>Tutor</TableHead>
                <TableHead>Raça</TableHead>
                <TableHead>Porte</TableHead>
                <TableHead>Pelagem</TableHead>
                <TableHead>Idade</TableHead>
                <TableHead>Alergias</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((p) => {
                const c = tutor(p.cliente_id);
                return (
                  <TableRow key={p.id} className={p.ativo ? "" : "opacity-60"}>
                    <TableCell className="font-medium">
                      {p.nome}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {rotulo(ESPECIES, p.especie)}
                      </span>
                      {!p.ativo && (
                        <Badge variant="outline" className="ml-2">
                          Inativo
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {c?.nome ?? "—"}
                      {c?.telefone && (
                        <span className="block text-xs text-muted-foreground">{c.telefone}</span>
                      )}
                    </TableCell>
                    <TableCell>{p.raca ?? "—"}</TableCell>
                    <TableCell>{rotulo(PORTES, p.porte) || "—"}</TableCell>
                    <TableCell>{rotulo(PELAGENS, p.pelagem) || "—"}</TableCell>
                    <TableCell title={p.nascimento ? dateBR(p.nascimento) : ""}>
                      {idadeDoPet(p.nascimento) || "—"}
                    </TableCell>
                    <TableCell className="max-w-48 truncate">{p.alergias ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {clinica && (
                        <Button
                          asChild
                          variant="ghost"
                          size="icon"
                          aria-label={`Cartão de vacinação de ${p.nome}`}
                        >
                          <Link to="/clinica-cartao" search={{ pet: p.id }}>
                            <Syringe className="size-4" />
                          </Link>
                        </Button>
                      )}
                      {podeEditar && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Editar ${p.nome}`}
                          onClick={() => {
                            setForm({
                              id: p.id,
                              cliente_id: p.cliente_id,
                              nome: p.nome,
                              especie: p.especie,
                              raca: p.raca ?? "",
                              porte: p.porte ?? "",
                              sexo: p.sexo ?? "",
                              pelagem: p.pelagem ?? "",
                              peso_kg: p.peso_kg != null ? String(p.peso_kg) : "",
                              nascimento: p.nascimento ?? "",
                              castrado: Boolean(p.castrado),
                              alergias: p.alergias ?? "",
                              observacoes: p.observacoes ?? "",
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
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={aberto} onOpenChange={(o) => !o && setAberto(false)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar pet" : "Novo pet"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Tutor (cliente)</Label>
              <ClienteCombobox
                clientes={clientes}
                value={form.cliente_id}
                onChange={(id) => setForm({ ...form, cliente_id: id })}
                placeholder="Digite o nome do tutor…"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                O tutor precisa estar em <strong>Clientes</strong>; cadastre lá antes, se for novo.
              </p>
            </div>
            <div>
              <Label htmlFor="pet-nome">Nome do pet</Label>
              <Input
                id="pet-nome"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="pet-especie">Espécie</Label>
              {sel(
                form.especie,
                (v) => setForm({ ...form, especie: v || "cao" }),
                ESPECIES,
                false,
                "pet-especie",
              )}
            </div>
            <div>
              <Label htmlFor="pet-raca">Raça</Label>
              <Input
                id="pet-raca"
                value={form.raca}
                placeholder="Ex.: Poodle, SRD"
                onChange={(e) => setForm({ ...form, raca: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="pet-sexo">Sexo</Label>
              {sel(form.sexo, (v) => setForm({ ...form, sexo: v }), SEXOS, true, "pet-sexo")}
            </div>
            <div>
              <Label htmlFor="pet-porte">Porte</Label>
              {sel(form.porte, (v) => setForm({ ...form, porte: v }), PORTES, true, "pet-porte")}
            </div>
            <div>
              <Label htmlFor="pet-pelagem">Pelagem</Label>
              {sel(
                form.pelagem,
                (v) => setForm({ ...form, pelagem: v }),
                PELAGENS,
                true,
                "pet-pelagem",
              )}
            </div>
            <div>
              <Label htmlFor="pet-peso">Peso (kg)</Label>
              <Input
                id="pet-peso"
                inputMode="decimal"
                value={form.peso_kg}
                onChange={(e) => setForm({ ...form, peso_kg: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="pet-nasc">Nascimento</Label>
              <Input
                id="pet-nasc"
                type="date"
                value={form.nascimento}
                onChange={(e) => setForm({ ...form, nascimento: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="pet-castrado"
                checked={form.castrado}
                onCheckedChange={(v) => setForm({ ...form, castrado: v })}
              />
              <Label htmlFor="pet-castrado">Castrado</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="pet-ativo"
                checked={form.ativo}
                onCheckedChange={(v) => setForm({ ...form, ativo: v })}
              />
              <Label htmlFor="pet-ativo">Ativo</Label>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="pet-alergias">Alergias e cuidados</Label>
              <Input
                id="pet-alergias"
                value={form.alergias}
                onChange={(e) => setForm({ ...form, alergias: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="pet-obs">Observações</Label>
              <Textarea
                id="pet-obs"
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
    </div>
  );
}
