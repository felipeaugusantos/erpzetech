import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
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
import {
  erroDoAcessoNovo,
  perfilDoProfissional,
  usuarioSugeridoDoNome,
} from "@/lib/profissional-acesso";
import { criarUsuario } from "@/lib/usuario-admin.functions";
import { FUNCOES_PROFISSIONAL, UFS_CRMV, crmvValido, normalizarCrmv, rotulo } from "@/lib/pet";

export const Route = createFileRoute("/_authenticated/pet-profissionais")({
  head: () => ({
    meta: [
      { title: "Profissionais do pet shop — EZRA ERP" },
      {
        name: "description",
        content: "Banhistas, tosadores e demais profissionais, com a comissão de cada um.",
      },
      { property: "og:title", content: "Profissionais do pet shop — EZRA ERP" },
      { property: "og:description", content: "Equipe de atendimento e acessos dos profissionais." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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
  /** só para veterinário */
  crmv: string;
  crmv_uf: string;
  /** conta de acesso (perfil Profissional) ligada ao cadastro; vazio = sem acesso próprio */
  profile_id: string;
  profile_original: string;
  /** criar o acesso junto com o cadastro (só o administrador) */
  criar_acesso: boolean;
  novo_usuario: string;
  nova_senha: string;
};

const vazio: Form = {
  nome: "",
  funcao: "tosador",
  comissao_percentual: "0",
  filial_id: "",
  ativo: true,
  crmv: "",
  crmv_uf: "",
  profile_id: "",
  profile_original: "",
  criar_acesso: false,
  novo_usuario: "",
  nova_senha: "",
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
  // criar o login é do administrador (o servidor confere de novo)
  const souAdmin = (session?.roles ?? []).includes("administrador");
  const fnCriarUsuario = useServerFn(criarUsuario);
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

  // usuários com o perfil Profissional (a conta é criada em Usuários e perfis)
  const { data: contas = [] } = useQuery({
    queryKey: ["pet-profissional-contas"],
    enabled: podeEditar,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id, role, profiles(nome, usuario, email, ativo)")
        .in("role", ["profissional", "veterinario"]);
      if (error) throw error;
      return (data ?? []).map((r) => {
        const pf = r.profiles as unknown as {
          nome: string;
          usuario: string | null;
          email: string;
          ativo: boolean;
        } | null;
        return {
          id: r.user_id,
          papel: r.role as string,
          nome: `${pf?.nome ?? pf?.email ?? "Usuário"}${pf?.usuario ? ` (${pf.usuario})` : ""}`,
          ativo: pf?.ativo ?? false,
        };
      });
    },
  });
  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim()) throw new Error("Informe o nome do profissional.");
      if (form.funcao === "veterinario" && !crmvValido(form.crmv, form.crmv_uf))
        throw new Error("Informe o CRMV (de 3 a 12 letras ou números) e a UF do veterinário.");
      const com = Number((form.comissao_percentual || "0").replace(",", "."));
      if (!Number.isFinite(com) || com < 0 || com > 100)
        throw new Error("A comissão precisa ficar entre 0 e 100%.");
      const criarAcesso = form.criar_acesso && souAdmin && !form.profile_id;
      if (criarAcesso) {
        const erroAcesso = erroDoAcessoNovo(form.novo_usuario, form.nova_senha);
        if (erroAcesso) throw new Error(erroAcesso);
      }
      const { data: id, error } = await supabase.rpc("pet_profissional_salvar", {
        p_dados: {
          ...(form.id ? { id: form.id } : {}),
          nome: form.nome.trim(),
          funcao: form.funcao,
          comissao_percentual: com,
          filial_id: form.filial_id || null,
          ativo: form.ativo,
          ...(form.funcao === "veterinario"
            ? { crmv: normalizarCrmv(form.crmv), crmv_uf: form.crmv_uf }
            : {}),
        },
      });
      if (error) throw error;
      // depois de salvo, salvar de novo (se o acesso falhar) atualiza este cadastro em vez de criar outro
      setForm((f) => ({ ...f, id: id as string }));
      if (criarAcesso) {
        let novoId: string;
        try {
          const novo = await fnCriarUsuario({
            data: {
              nome: form.nome.trim(),
              usuario: form.novo_usuario,
              senha: form.nova_senha,
              filialId: form.filial_id || null,
              perfis: [perfilDoProfissional(form.funcao)],
            },
          });
          novoId = novo.id;
        } catch (e) {
          throw new Error(
            `Profissional salvo, mas o acesso não foi criado: ${(e as Error).message}`,
          );
        }
        void qc.invalidateQueries({ queryKey: ["pet-profissional-contas"] });
        const lig = await supabase.rpc("pet_profissional_vincular", {
          p_profissional_id: id as string,
          p_profile_id: novoId,
        });
        if (lig.error) {
          // a conta já existe: o formulário passa a apontar para ela, e salvar de novo só tenta a ligação
          setForm((f) => ({ ...f, profile_id: novoId, criar_acesso: false, nova_senha: "" }));
          throw new Error(
            `Profissional salvo e acesso criado, mas a conta não foi ligada (${lig.error.message}). Salve de novo para ligar.`,
          );
        }
        return;
      }
      if (form.profile_id !== form.profile_original) {
        const lig = await supabase.rpc("pet_profissional_vincular", {
          p_profissional_id: id as string,
          p_profile_id: (form.profile_id || null) as unknown as string,
        });
        if (lig.error)
          throw new Error(`Profissional salvo, mas a conta não foi ligada: ${lig.error.message}`);
      }
    },
    onSuccess: () => {
      toast.success(form.id ? "Profissional atualizado." : "Profissional cadastrado.", {
        description: form.criar_acesso
          ? `Acesso em /auth com usuário, senha e código da empresa: ${session?.profile?.tenant_id ?? ""}`
          : undefined,
      });
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
                            crmv: p.crmv ?? "",
                            crmv_uf: p.crmv_uf ?? "",
                            profile_id: p.profile_id ?? "",
                            profile_original: p.profile_id ?? "",
                            criar_acesso: false,
                            novo_usuario: "",
                            nova_senha: "",
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
            {form.funcao === "veterinario" && (
              <div className="grid grid-cols-[1fr_6rem] gap-3">
                <div>
                  <Label htmlFor="pf-crmv">CRMV</Label>
                  <Input
                    id="pf-crmv"
                    value={form.crmv}
                    placeholder="Ex.: 12345"
                    onChange={(e) => setForm({ ...form, crmv: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="pf-uf">UF</Label>
                  <Select
                    value={form.crmv_uf || "__sem_uf"}
                    onValueChange={(v) => setForm({ ...form, crmv_uf: v === "__sem_uf" ? "" : v })}
                  >
                    <SelectTrigger id="pf-uf">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__sem_uf">—</SelectItem>
                      {UFS_CRMV.map((u) => (
                        <SelectItem key={u} value={u}>
                          {u}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
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
            {podeEditar && (
              <div>
                <Label htmlFor="pf-conta">Conta de acesso</Label>
                <Select
                  value={form.profile_id || SEM_LOJA}
                  onValueChange={(v) => setForm({ ...form, profile_id: v === SEM_LOJA ? "" : v })}
                >
                  <SelectTrigger id="pf-conta">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_LOJA}>Sem acesso próprio</SelectItem>
                    {contas
                      .filter(
                        (c) =>
                          c.ativo &&
                          c.papel ===
                            (form.funcao === "veterinario" ? "veterinario" : "profissional") &&
                          !lista.some((x) => x.profile_id === c.id && x.id !== form.id),
                      )
                      .map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nome}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Escolha uma conta que já existe ou crie o acesso agora (abaixo). Ele entra e vê só
                  a própria agenda
                  {form.funcao === "veterinario" ? " e o prontuário" : ""}.
                </p>
              </div>
            )}
            {podeEditar && souAdmin && !form.profile_id && (
              <div className="grid gap-2 rounded-md border border-border p-3">
                <div className="flex items-center gap-2">
                  <Switch
                    id="pf-criar-acesso"
                    checked={form.criar_acesso}
                    onCheckedChange={(v) =>
                      setForm({
                        ...form,
                        criar_acesso: v,
                        novo_usuario: form.novo_usuario || usuarioSugeridoDoNome(form.nome),
                      })
                    }
                  />
                  <Label htmlFor="pf-criar-acesso">Criar o acesso agora</Label>
                </div>
                {form.criar_acesso && (
                  <>
                    <div>
                      <Label htmlFor="pf-usuario">Usuário</Label>
                      <Input
                        id="pf-usuario"
                        autoComplete="off"
                        value={form.novo_usuario}
                        onChange={(e) => setForm({ ...form, novo_usuario: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="pf-senha">Senha (mínimo 8 caracteres)</Label>
                      <Input
                        id="pf-senha"
                        type="password"
                        autoComplete="new-password"
                        value={form.nova_senha}
                        onChange={(e) => setForm({ ...form, nova_senha: e.target.value })}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      O perfil {form.funcao === "veterinario" ? "Veterinário" : "Profissional"} é
                      dado sozinho e a conta já fica ligada a este cadastro.
                    </p>
                  </>
                )}
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
