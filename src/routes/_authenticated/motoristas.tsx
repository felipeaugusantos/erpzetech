import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IdCard, KeyRound, Pencil, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { criarLoginMotorista } from "@/lib/motorista-login.functions";
import { dateBR } from "@/lib/format";
import { PageHeader, EmptyState, StatCard } from "@/components/app/PageHeader";
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

export const Route = createFileRoute("/_authenticated/motoristas")({
  head: () => ({
    meta: [
      { title: "Motoristas — Ze Obra" },
      {
        name: "description",
        content: "Motoristas da loja com CNH, validade, telefone e veículo habitual.",
      },
      { property: "og:title", content: "Motoristas — Ze Obra" },
      { property: "og:description", content: "Equipe responsável pelas entregas de material." },
    ],
  }),
  component: Motoristas,
});

type Form = {
  id?: string;
  nome: string;
  telefone: string;
  cnh: string;
  categoria_cnh: string;
  validade_cnh: string;
  veiculo_id: string;
  observacao: string;
  ativo: boolean;
};

const vazio: Form = {
  nome: "",
  telefone: "",
  cnh: "",
  categoria_cnh: "C",
  validade_cnh: "",
  veiculo_id: "",
  observacao: "",
  ativo: true,
};

function Motoristas() {
  const { data: session } = useSessionData();
  const profile = session?.profile;
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Form>(vazio);
  const [loginMotorista, setLoginMotorista] = useState<{ id: string; nome: string } | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginSenha, setLoginSenha] = useState("");

  const criarLogin = useMutation({
    mutationFn: async () => {
      if (!loginMotorista) return;
      await criarLoginMotorista({
        data: { motoristaId: loginMotorista.id, email: loginEmail, senha: loginSenha },
      });
    },
    onSuccess: () => {
      toast.success("Login do motorista criado. Passe o e-mail e a senha para ele.");
      setLoginMotorista(null);
      void queryClient.invalidateQueries({ queryKey: ["motoristas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: motoristas = [], isLoading } = useQuery({
    queryKey: ["motoristas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("motoristas")
        .select("*, veiculos(placa, descricao)")
        .order("nome");
      if (error) throw error;
      return data;
    },
  });

  const { data: veiculos = [] } = useQuery({
    queryKey: ["veiculos-ativos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("veiculos")
        .select("id, placa, descricao")
        .eq("ativo", true)
        .order("descricao");
      if (error) throw error;
      return data;
    },
  });

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return motoristas;
    return motoristas.filter((m) =>
      [m.nome, m.telefone, m.cnh].filter(Boolean).some((x) => String(x).toLowerCase().includes(t)),
    );
  }, [motoristas, busca]);

  const cnhVencendo = motoristas.filter((m) => {
    if (!m.validade_cnh) return false;
    const dias = (new Date(m.validade_cnh).getTime() - Date.now()) / 86_400_000;
    return dias <= 60;
  }).length;

  const salvar = useMutation({
    mutationFn: async () => {
      if (!profile?.tenant_id || !profile?.empresa_id) throw new Error("Usuário sem empresa vinculada");
      if (!form.nome.trim()) throw new Error("Informe o nome do motorista");
      const payload = {
        tenant_id: profile.tenant_id,
        empresa_id: profile.empresa_id,
        filial_id: profile.filial_id ?? null,
        nome: form.nome.trim(),
        telefone: form.telefone || null,
        cnh: form.cnh || null,
        categoria_cnh: form.categoria_cnh || null,
        validade_cnh: form.validade_cnh || null,
        veiculo_id: form.veiculo_id || null,
        observacao: form.observacao || null,
        ativo: form.ativo,
      };
      if (form.id) {
        const { error } = await supabase.from("motoristas").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("motoristas").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(form.id ? "Motorista atualizado." : "Motorista cadastrado.");
      setAberto(false);
      setForm(vazio);
      void queryClient.invalidateQueries({ queryKey: ["motoristas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Motoristas"
        description="Quem leva o material até a obra, com CNH, contato e veículo habitual."
        actions={
          <Button
            onClick={() => {
              setForm(vazio);
              setAberto(true);
            }}
          >
            <Plus className="size-4" /> Novo motorista
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Motoristas" value={String(motoristas.length)} icon={IdCard} />
        <StatCard
          label="Ativos"
          value={String(motoristas.filter((m) => m.ativo).length)}
          tone="success"
        />
        <StatCard
          label="CNH vencendo em 60 dias"
          value={String(cnhVencendo)}
          tone={cnhVencendo > 0 ? "warning" : "default"}
        />
      </div>

      <div className="panel mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome, telefone ou CNH"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhum motorista encontrado."
          description="Cadastre os motoristas para planejar as entregas."
          action={
            <Button
              onClick={() => {
                setForm(vazio);
                setAberto(true);
              }}
            >
              <Plus className="size-4" /> Novo motorista
            </Button>
          }
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Motorista</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>CNH</TableHead>
                <TableHead>Validade</TableHead>
                <TableHead>Veículo</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((m) => {
                const veiculo = m.veiculos as unknown as
                  | { placa: string; descricao: string }
                  | null;
                const vencida = m.validade_cnh
                  ? new Date(m.validade_cnh).getTime() < Date.now()
                  : false;
                return (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.nome}</TableCell>
                    <TableCell className="text-numeric text-sm">{m.telefone ?? "—"}</TableCell>
                    <TableCell className="text-numeric text-sm">
                      {m.cnh ?? "—"}
                      {m.categoria_cnh ? ` · ${m.categoria_cnh}` : ""}
                    </TableCell>
                    <TableCell className="text-sm">
                      {dateBR(m.validade_cnh)}
                      {vencida && (
                        <Badge className="ml-2 bg-destructive/15 text-destructive">vencida</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {veiculo ? `${veiculo.descricao} (${veiculo.placa})` : "—"}
                    </TableCell>
                    <TableCell>
                      {m.ativo ? (
                        <Badge className="bg-success/15 text-success">Ativo</Badge>
                      ) : (
                        <Badge variant="outline">Inativo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {m.user_id ? (
                        <Badge variant="secondary" className="mr-1">
                          <KeyRound className="mr-1 size-3" /> com login
                        </Badge>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mr-1"
                          onClick={() => {
                            setLoginMotorista({ id: m.id, nome: m.nome });
                            setLoginEmail("");
                            setLoginSenha("");
                          }}
                        >
                          <KeyRound className="size-4" /> Criar login
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setForm({
                            id: m.id,
                            nome: m.nome,
                            telefone: m.telefone ?? "",
                            cnh: m.cnh ?? "",
                            categoria_cnh: m.categoria_cnh ?? "",
                            validade_cnh: m.validade_cnh ?? "",
                            veiculo_id: m.veiculo_id ?? "",
                            observacao: m.observacao ?? "",
                            ativo: m.ativo,
                          });
                          setAberto(true);
                        }}
                      >
                        <Pencil className="size-4" /> Editar
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar motorista" : "Novo motorista"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Nome</Label>
              <Input
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input
                value={form.telefone}
                onChange={(e) => setForm({ ...form, telefone: e.target.value })}
              />
            </div>
            <div>
              <Label>CNH</Label>
              <Input value={form.cnh} onChange={(e) => setForm({ ...form, cnh: e.target.value })} />
            </div>
            <div>
              <Label>Categoria</Label>
              <Select
                value={form.categoria_cnh}
                onValueChange={(v) => setForm({ ...form, categoria_cnh: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Categoria" />
                </SelectTrigger>
                <SelectContent>
                  {["A", "B", "C", "D", "E"].map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Validade da CNH</Label>
              <Input
                type="date"
                value={form.validade_cnh}
                onChange={(e) => setForm({ ...form, validade_cnh: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Veículo habitual</Label>
              <Select
                value={form.veiculo_id || "nenhum"}
                onValueChange={(v) => setForm({ ...form, veiculo_id: v === "nenhum" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sem veículo fixo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nenhum">Sem veículo fixo</SelectItem>
                  {veiculos.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.descricao} ({v.placa})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Switch
                checked={form.ativo}
                onCheckedChange={(v) => setForm({ ...form, ativo: v })}
              />
              <span className="text-sm">Motorista ativo</span>
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

      <Dialog open={loginMotorista !== null} onOpenChange={(o) => !o && setLoginMotorista(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Criar login de {loginMotorista?.nome}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              O motorista entra com este e-mail e senha e vê somente as entregas da própria rota.
            </p>
            <div>
              <Label>E-mail do motorista</Label>
              <Input
                type="email"
                value={loginEmail}
                placeholder="motorista@email.com"
                onChange={(e) => setLoginEmail(e.target.value)}
              />
            </div>
            <div>
              <Label>Senha provisória</Label>
              <Input
                value={loginSenha}
                placeholder="mínimo 8 caracteres"
                onChange={(e) => setLoginSenha(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLoginMotorista(null)}>
              Cancelar
            </Button>
            <Button onClick={() => criarLogin.mutate()} disabled={criarLogin.isPending}>
              Criar login
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
