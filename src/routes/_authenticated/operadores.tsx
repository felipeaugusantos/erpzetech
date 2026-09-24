import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { atualizarUsuario, criarUsuario, redefinirSenhaUsuario } from "@/lib/usuario-admin.functions";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/operadores")({
  head: () => ({
    meta: [
      { title: "Operadores de caixa — ERP Ze Tech" },
      { name: "description", content: "Cadastre operadores com login e senha e defina quem abre caixa e quem vê o fechamento." },
      { property: "og:title", content: "Operadores de caixa — ERP Ze Tech" },
      { property: "og:description", content: "Login, senha e permissões dos operadores da frente de caixa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Operadores,
});

type Op = { id: string; nome: string; email: string | null; ativo: boolean | null; pode_abrir_caixa: boolean; pode_ver_fechamento: boolean; perfis: string[] };

function Operadores() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const ehAdmin = session?.roles.includes("administrador");
  const criar = useServerFn(criarUsuario);
  const atualizar = useServerFn(atualizarUsuario);
  const senhaFn = useServerFn(redefinirSenhaUsuario);
  const [novo, setNovo] = useState<null | { nome: string; email: string; senha: string; abrir: boolean; ver: boolean }>(null);
  const [trocaSenha, setTrocaSenha] = useState<null | { id: string; nome: string; senha: string }>(null);

  const { data: ops = [] } = useQuery({
    queryKey: ["operadores"],
    queryFn: async () => {
      const [{ data: perfis, error }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("id, nome, email, ativo, pode_abrir_caixa, pode_ver_fechamento").order("nome"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (error) throw error;
      return (perfis ?? []).map((p) => ({ ...p, perfis: (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role as string) })) as Op[];
    },
  });
  const recarregar = () => void qc.invalidateQueries({ queryKey: ["operadores"] });

  const permissao = useMutation({
    mutationFn: async (o: { id: string; abrir: boolean; ver: boolean }) => {
      const { error } = await supabase.rpc("operador_definir_permissoes", { p_user_id: o.id, p_abrir: o.abrir, p_ver: o.ver });
      if (error) throw error;
    },
    onSuccess: recarregar,
    onError: (e: Error) => toast.error(e.message),
  });

  const salvarNovo = useMutation({
    mutationFn: async () => {
      const n = novo!;
      await criar({ data: { nome: n.nome, email: n.email, senha: n.senha, perfis: ["caixa"] } });
      await new Promise((r) => setTimeout(r, 300));
      const { data: p } = await supabase.from("profiles").select("id").eq("email", n.email).maybeSingle();
      if (p) await supabase.rpc("operador_definir_permissoes", { p_user_id: p.id, p_abrir: n.abrir, p_ver: n.ver });
    },
    onSuccess: () => { toast.success("Operador cadastrado"); setNovo(null); recarregar(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const ativar = useMutation({
    mutationFn: async (o: Op) => atualizar({ data: { userId: o.id, ativo: !(o.ativo ?? true) } }),
    onSuccess: recarregar,
    onError: (e: Error) => toast.error(e.message),
  });

  const salvarSenha = useMutation({
    mutationFn: async () => senhaFn({ data: { userId: trocaSenha!.id, senha: trocaSenha!.senha } }),
    onSuccess: () => { toast.success("Senha alterada"); setTrocaSenha(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Operadores de caixa"
        description="Login e senha de cada operador e quem pode abrir caixa ou ver o relatório de fechamento."
        actions={ehAdmin ? <Button onClick={() => setNovo({ nome: "", email: "", senha: "", abrir: true, ver: false })}>Novo operador</Button> : undefined}
      />
      {!ehAdmin && <p className="mb-3 text-sm text-muted-foreground">Somente o administrador altera operadores e permissões.</p>}
      <div className="panel overflow-x-auto p-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Operador</TableHead>
              <TableHead>Perfis</TableHead>
              <TableHead className="text-center">Abre caixa</TableHead>
              <TableHead className="text-center">Vê fechamento</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ops.map((o) => {
              const gestor = o.perfis.includes("administrador") || o.perfis.includes("gestor");
              return (
                <TableRow key={o.id}>
                  <TableCell><b>{o.nome}</b><p className="text-xs text-muted-foreground">{o.email}</p></TableCell>
                  <TableCell className="text-xs">{o.perfis.join(", ") || "—"}</TableCell>
                  <TableCell className="text-center">
                    <Switch checked={o.pode_abrir_caixa} disabled={!ehAdmin} onCheckedChange={(v) => permissao.mutate({ id: o.id, abrir: v, ver: o.pode_ver_fechamento })} />
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch checked={gestor || o.pode_ver_fechamento} disabled={!ehAdmin || gestor} onCheckedChange={(v) => permissao.mutate({ id: o.id, abrir: o.pode_abrir_caixa, ver: v })} />
                    {gestor && <p className="text-[10px] text-muted-foreground">pelo perfil</p>}
                  </TableCell>
                  <TableCell>{o.ativo === false ? "Inativo" : "Ativo"}</TableCell>
                  <TableCell className="space-x-1 text-right">
                    {ehAdmin && o.id !== session?.user.id && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setTrocaSenha({ id: o.id, nome: o.nome, senha: "" })}>Senha</Button>
                        <Button size="sm" variant="ghost" onClick={() => ativar.mutate(o)}>{o.ativo === false ? "Ativar" : "Inativar"}</Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!novo} onOpenChange={(o) => !o && setNovo(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo operador de caixa</DialogTitle></DialogHeader>
          {novo && (
            <div className="space-y-3">
              <div><Label>Nome</Label><Input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} /></div>
              <div><Label>E-mail (login)</Label><Input type="email" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} /></div>
              <div><Label>Senha</Label><Input type="password" value={novo.senha} onChange={(e) => setNovo({ ...novo, senha: e.target.value })} /></div>
              <label className="flex items-center gap-2 text-sm"><Switch checked={novo.abrir} onCheckedChange={(v) => setNovo({ ...novo, abrir: v })} /> Pode abrir caixa</label>
              <label className="flex items-center gap-2 text-sm"><Switch checked={novo.ver} onCheckedChange={(v) => setNovo({ ...novo, ver: v })} /> Pode ver o relatório de fechamento de todos</label>
            </div>
          )}
          <DialogFooter><Button disabled={salvarNovo.isPending} onClick={() => salvarNovo.mutate()}>Cadastrar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!trocaSenha} onOpenChange={(o) => !o && setTrocaSenha(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova senha — {trocaSenha?.nome}</DialogTitle></DialogHeader>
          <Input type="password" value={trocaSenha?.senha ?? ""} onChange={(e) => setTrocaSenha((t) => t && { ...t, senha: e.target.value })} />
          <DialogFooter><Button disabled={salvarSenha.isPending} onClick={() => salvarSenha.mutate()}>Salvar senha</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
