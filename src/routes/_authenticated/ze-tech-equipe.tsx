import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldCheck, Trash2, Users, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cadastrarEquipeZeTech, listarEquipeZeTech, removerEquipeZeTech } from "@/lib/equipe-ze-tech.functions";
import { useSaasOperador } from "@/lib/saas";
import { PageHeader, EmptyState } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/ze-tech-equipe")({
  head: () => ({ meta: [
    { title: "Equipe Ze Tech — ERP Ze Tech" },
    { name: "description", content: "Gestão de integrantes e acessos da equipe Ze Tech ao painel do fabricante." },
    { property: "og:title", content: "Equipe Ze Tech — ERP Ze Tech" },
    { property: "og:description", content: "Integrantes e acessos da equipe ao painel Ze Tech." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex" },
  ] }),
  component: EquipeZeTech,
});

const vazio = { nome: "", email: "", modo: "novo" as "novo" | "existente", senha: "" };
function EquipeZeTech() {
  const qc = useQueryClient();
  const { data: operador, isLoading: acessoCarregando } = useSaasOperador();
  const listar = useServerFn(listarEquipeZeTech);
  const cadastrar = useServerFn(cadastrarEquipeZeTech);
  const remover = useServerFn(removerEquipeZeTech);
  const equipe = useQuery({ queryKey: ["ze-tech-equipe"], queryFn: () => listar(), enabled: operador === true, staleTime: 0, gcTime: 0, retry: false });
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState(vazio);
  const [alvo, setAlvo] = useState<{ user_id: string; nome: string | null; email: string } | null>(null);
  const salvar = useMutation({
    mutationFn: () => cadastrar({ data: form }),
    onSuccess: (r) => {
      toast.success(r.confirmacaoPendente ? "Conta cadastrada. A pessoa precisa confirmar o e-mail antes de entrar." : "Acesso à equipe liberado.");
      setAberto(false); setForm(vazio);
      void qc.invalidateQueries({ queryKey: ["ze-tech-equipe"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const excluir = useMutation({
    mutationFn: async () => {
      if (!alvo) throw new Error("Selecione um integrante.");
      return remover({ data: { userId: alvo.user_id } });
    },
    onSuccess: () => { toast.success("Acesso ao painel removido."); setAlvo(null); void qc.invalidateQueries({ queryKey: ["ze-tech-equipe"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (acessoCarregando) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!operador) return <EmptyState title="Área exclusiva da equipe Ze Tech" description="Esta conta não tem acesso ao painel do fabricante." />;
  return <>
    <PageHeader title="Equipe Ze Tech" actions={<>
      <Button asChild variant="outline"><Link to="/ze-tech">Painel de clientes</Link></Button>
      <Button variant="outline" size="icon" aria-label="Atualizar equipe" title="Atualizar equipe" onClick={() => void equipe.refetch()} disabled={equipe.isFetching}><RefreshCw className="size-4" /></Button>
      {equipe.data?.podeGerenciar && <Button onClick={() => { setForm(vazio); setAberto(true); salvar.reset(); }}><Plus className="size-4" />Adicionar pessoa</Button>}
    </>} />
    {equipe.isPending ? <p className="text-sm text-muted-foreground">Carregando equipe…</p> : equipe.isError ? <div role="alert" className="text-destructive">{equipe.error.message}</div> : <>
      <div className="mb-5 flex items-center gap-2 text-sm text-muted-foreground"><Users className="size-4" />{equipe.data.membros.length} integrantes</div>
      <div className="overflow-x-auto rounded-md border bg-card">
        <Table><TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>E-mail</TableHead><TableHead>Acesso</TableHead><TableHead>Conta</TableHead><TableHead className="w-16"><span className="sr-only">Ações</span></TableHead></TableRow></TableHeader>
          <TableBody>{equipe.data.membros.map((m) => <TableRow key={m.user_id}>
            <TableCell className="font-medium">{m.nome || "—"}</TableCell>
            <TableCell className="break-all">{m.email}</TableCell>
            <TableCell><Badge variant={m.principal ? "default" : "secondary"}>{m.principal && <ShieldCheck className="mr-1 size-3" />}{m.principal ? "Administrador" : "Equipe"}</Badge></TableCell>
            <TableCell><Badge variant="outline">{m.confirmado ? "Confirmada" : "Confirmação pendente"}</Badge></TableCell>
            <TableCell>{equipe.data.podeGerenciar && !m.principal && <Button variant="ghost" size="icon" aria-label={`Remover acesso de ${m.nome || m.email}`} title="Remover acesso" onClick={() => setAlvo(m)}><Trash2 className="size-4 text-destructive" /></Button>}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </div>
    </>}
    <Dialog open={aberto} onOpenChange={(v) => { if (!salvar.isPending) { setAberto(v); if (!v) setForm(vazio); } }}>
      <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Adicionar pessoa à equipe</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); salvar.mutate(); }} className="space-y-4">
          <Tabs value={form.modo} onValueChange={(v) => setForm({ ...form, modo: v === "existente" ? "existente" : "novo", senha: "" })}><TabsList className="grid w-full grid-cols-2"><TabsTrigger value="novo">Nova conta</TabsTrigger><TabsTrigger value="existente">Conta existente</TabsTrigger></TabsList></Tabs>
          <div className="space-y-2"><Label htmlFor="equipe-nome">Nome</Label><Input id="equipe-nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required minLength={2} maxLength={120} autoComplete="name" /></div>
          <div className="space-y-2"><Label htmlFor="equipe-email">E-mail</Label><Input id="equipe-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoComplete="email" /></div>
          {form.modo === "novo" && <div className="space-y-2"><Label htmlFor="equipe-senha">Senha inicial</Label><Input id="equipe-senha" type="password" value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} required minLength={12} maxLength={128} autoComplete="new-password" /></div>}
          {salvar.isError && <p role="alert" className="text-sm text-destructive">{salvar.error.message}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => { setAberto(false); setForm(vazio); }} disabled={salvar.isPending}>Cancelar</Button><Button type="submit" disabled={salvar.isPending}>{salvar.isPending ? "Salvando…" : "Liberar acesso"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(alvo)} onOpenChange={(v) => { if (!v && !excluir.isPending) setAlvo(null); }}>
      <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Remover acesso ao painel?</DialogTitle><DialogDescription>{alvo?.nome || alvo?.email} perderá o acesso à área Ze Tech. A conta e os acessos às lojas serão mantidos.</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" onClick={() => setAlvo(null)} disabled={excluir.isPending}>Cancelar</Button><Button variant="destructive" onClick={() => excluir.mutate()} disabled={excluir.isPending}>{excluir.isPending ? "Removendo…" : "Remover acesso"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}