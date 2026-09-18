import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { initials } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/usuarios")({
  head: () => ({
    meta: [
      { title: "Usuários e perfis — ERP Ze Tech" },
      { name: "description", content: "Usuários da empresa, perfis de acesso e permissões por módulo." },
      { property: "og:title", content: "Usuários e perfis — ERP Ze Tech" },
      { property: "og:description", content: "Controle de acesso da equipe." },
    ],
  }),
  component: Usuarios,
});

const perfis = [
  "administrador",
  "gestor",
  "vendedor",
  "caixa",
  "estoquista",
  "comprador",
  "financeiro",
  "logistica",
  "motorista",
];

function Usuarios() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const isAdmin = session?.roles.includes("administrador") ?? false;

  const { data, isLoading } = useQuery({
    queryKey: ["usuarios"],
    queryFn: async () => {
      const [perfilsRes, rolesRes, permsRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, nome, codigo, email, ativo, filial_id")
          .order("nome"),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("role_permissoes").select("*").order("modulo"),
      ]);
      return {
        usuarios: perfilsRes.data ?? [],
        roles: rolesRes.data ?? [],
        permissoes: permsRes.data ?? [],
      };
    },
  });

  const alterarPermissao = useMutation({
    mutationFn: async ({
      id,
      campo,
      valor,
    }: {
      id: string;
      campo: "pode_ver" | "pode_criar" | "pode_editar" | "pode_excluir";
      valor: boolean;
    }) => {
      const patch: {
        pode_ver?: boolean;
        pode_criar?: boolean;
        pode_editar?: boolean;
        pode_excluir?: boolean;
      } = { [campo]: valor };
      const { error } = await supabase.from("role_permissoes").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Permissão atualizada");
      qc.invalidateQueries({ queryKey: ["usuarios"] });
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  /** Código do vendedor usado no orçamento e no pedido. */
  const salvarCodigo = useMutation({
    mutationFn: async ({ id, codigo }: { id: string; codigo: string }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ codigo: codigo.trim() || null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Código salvo");
      qc.invalidateQueries({ queryKey: ["usuarios"] });
    },
    onError: (e: Error) => toast.error("Erro ao salvar código", { description: e.message }),
  });

  const modulos = [...new Set((data?.permissoes ?? []).map((p) => p.modulo))];

  return (
    <>
      <PageHeader
        title="Usuários e perfis"
        description="Nove perfis operacionais com permissões configuráveis por módulo."
      />

      <Tabs defaultValue="usuarios">
        <TabsList>
          <TabsTrigger value="usuarios">Usuários</TabsTrigger>
          <TabsTrigger value="permissoes">Permissões</TabsTrigger>
        </TabsList>

        <TabsContent value="usuarios" className="mt-4">
          {isLoading ? (
            <div className="panel h-52 animate-pulse" />
          ) : (data?.usuarios.length ?? 0) === 0 ? (
            <EmptyState title="Nenhum usuário encontrado." />
          ) : (
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuário</TableHead>
                    <TableHead className="w-28">Código</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Perfis</TableHead>
                    <TableHead>Filial</TableHead>
                    <TableHead>Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data!.usuarios.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="size-8">
                            <AvatarFallback className="bg-primary text-xs text-primary-foreground">
                              {initials(u.nome)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{u.nome || "Sem nome"}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {isAdmin ? (
                          <Input
                            className="h-9 w-24 text-center font-mono"
                            defaultValue={u.codigo ?? ""}
                            placeholder="001"
                            aria-label={`Código de ${u.nome || "usuário"}`}
                            onBlur={(e) => {
                              const v = e.target.value;
                              if (v.trim() === (u.codigo ?? "").trim()) return;
                              salvarCodigo.mutate({ id: u.id, codigo: v });
                            }}
                          />
                        ) : (
                          <span className="font-mono text-sm">{u.codigo ?? "—"}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{u.email ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {data!.roles
                            .filter((r) => r.user_id === u.id)
                            .map((r) => (
                              <Badge key={r.role} variant="secondary" className="capitalize">
                                {r.role}
                              </Badge>
                            ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {session?.filiais.find((f) => f.id === u.filial_id)?.nome ?? "—"}
                      </TableCell>
                      <TableCell>
                        {u.ativo ? (
                          <span className="inline-flex items-center gap-1 text-sm text-success">
                            <Check className="size-3.5" /> Ativo
                          </span>
                        ) : (
                          <Badge variant="outline">Inativo</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Novos usuários entram automaticamente na empresa como administrador nesta versão de
            demonstração. Convites por e-mail e troca de perfil chegam na próxima fase.
          </p>
        </TabsContent>

        <TabsContent value="permissoes" className="mt-4">
          {!isAdmin && (
            <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="size-4" /> Somente administradores podem alterar permissões.
            </p>
          )}
          <div className="space-y-4">
            {perfis.map((perfil) => (
              <div key={perfil} className="panel overflow-x-auto">
                <div className="border-b border-border px-4 py-3">
                  <p className="font-display text-sm font-semibold capitalize">{perfil}</p>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Módulo</TableHead>
                      <TableHead className="text-center">Ver</TableHead>
                      <TableHead className="text-center">Criar</TableHead>
                      <TableHead className="text-center">Editar</TableHead>
                      <TableHead className="text-center">Excluir</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {modulos.map((modulo) => {
                      const p = (data?.permissoes ?? []).find(
                        (x) => x.role === perfil && x.modulo === modulo,
                      );
                      if (!p) return null;
                      return (
                        <TableRow key={`${perfil}-${modulo}`}>
                          <TableCell className="capitalize">{modulo}</TableCell>
                          {(["pode_ver", "pode_criar", "pode_editar", "pode_excluir"] as const).map(
                            (campo) => (
                              <TableCell key={campo} className="text-center">
                                <Checkbox
                                  checked={p[campo]}
                                  disabled={!isAdmin || alterarPermissao.isPending}
                                  onCheckedChange={(v) =>
                                    alterarPermissao.mutate({ id: p.id, campo, valor: Boolean(v) })
                                  }
                                />
                              </TableCell>
                            ),
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
