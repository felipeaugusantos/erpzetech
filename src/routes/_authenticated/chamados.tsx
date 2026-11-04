import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { ExternalLink, Plus, RefreshCw, MessageCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { listarChamados, abrirChamado } from "@/lib/help-chamados.functions";
import { situacoesChamado } from "@/lib/help-chamados";
import { useSessionData } from "@/hooks/useSessionData";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dateBR } from "@/lib/format";

const opcoesChamados = (page: number) => queryOptions({
  queryKey: ["help-chamados", page],
  queryFn: () => listarChamados({ data: { page } }),
  staleTime: 30000,
});

export const Route = createFileRoute("/_authenticated/chamados")({
  head: () => ({ meta: [
    { title: "Chamados de suporte — ERP Ze Tech" },
    { name: "description", content: "Atendimento Ze Tech: chamados e prazos da sua empresa." },
    { property: "og:title", content: "Chamados de suporte — ERP Ze Tech" },
    { property: "og:description", content: "Atendimento Ze Tech: chamados e prazos da sua empresa." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(opcoesChamados(1)),
  component: Chamados,
});

function Chamados() {
  const [page, setPage] = useState(1);
  const { data: lista, isFetching, refetch } = useSuspenseQuery(opcoesChamados(page));
  const { data: sessao } = useSessionData();
  const queryClient = useQueryClient();
  const enviar = useServerFn(abrirChamado);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"baixa" | "normal" | "alta" | "critica">("normal");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState("");
  const [enviado, setEnviado] = useState(false);

  useEffect(() => {
    if (!name) setName(sessao?.profile?.nome ?? "");
    if (!email) setEmail(sessao?.profile?.email ?? "");
  }, [sessao, name, email]);

  async function salvar(event: React.FormEvent) {
    event.preventDefault();
    if (busy || enviado) return;
    setBusy(true); setErro("");
    try {
      const result = await enviar({ data: { requestId, subject, description, priority, name, email } });
      if (result.error) { setErro(result.error); return; }
      if (!result.ticket) { setErro("A central não confirmou o chamado. Tente novamente."); return; }
      setEnviado(true);
      toast.success(`Chamado ${result.ticket.number} registrado.`);
      if (result.portalUserCreated && result.welcomeEmailSent === false)
        toast.warning("Chamado registrado, mas o e-mail de acesso não foi enviado. Use Esqueci minha senha na central.");
      await queryClient.invalidateQueries({ queryKey: ["help-chamados"] });
      setOpen(false); setSubject(""); setDescription(""); setPriority("normal");
    } catch {
      setErro("Não foi possível confirmar o envio. Tente novamente sem fechar este formulário.");
    } finally { setBusy(false); }
  }

  return <div className="space-y-6">
    <PageHeader title="Chamados de suporte" actions={<>
      <Button variant="outline" asChild><a href="https://helpzetech.lovable.app" target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4" />Central de chamados</a></Button>
      <Button variant="outline" size="icon" title="Atualizar chamados" aria-label="Atualizar chamados" disabled={isFetching} onClick={() => refetch()}><RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} /></Button>
      <Button onClick={() => { setRequestId(crypto.randomUUID()); setErro(""); setEnviado(false); setOpen(true); }}><Plus className="size-4" />Novo chamado</Button>
    </>} />
    {lista.error ? <div role="alert" className="border-l-4 border-destructive bg-destructive/5 p-4 text-sm">{lista.error}</div> : <>
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><MessageCircle className="size-4" /><span>{lista.total} chamado{lista.total !== 1 ? "s" : ""}</span></div>
      {lista.tickets.length === 0 ? <div className="border-y py-14 text-center text-muted-foreground">Nenhum chamado registrado.</div> : <div className="overflow-x-auto border-y">
        <Table><TableHeader><TableRow><TableHead>Número</TableHead><TableHead>Assunto</TableHead><TableHead>Situação</TableHead><TableHead>Prioridade</TableHead><TableHead>Abertura</TableHead><TableHead>Prazo</TableHead></TableRow></TableHeader>
          <TableBody>{lista.tickets.map((t) => <TableRow key={t.id}>
            <TableCell className="whitespace-nowrap font-medium">{t.number}</TableCell><TableCell className="min-w-48 max-w-96 break-words">{t.subject}</TableCell>
            <TableCell><Badge variant="secondary">{situacoesChamado[t.status] ?? t.status.replaceAll("_", " ")}</Badge></TableCell>
            <TableCell className="capitalize">{t.priority === "critica" ? "Crítica" : t.priority}</TableCell><TableCell className="whitespace-nowrap">{dateBR(t.created_at)}</TableCell><TableCell className="whitespace-nowrap">{t.resolution_due_at ? dateBR(t.resolution_due_at) : "—"}</TableCell>
          </TableRow>)}</TableBody></Table>
      </div>}
      {lista.total > 20 && <div className="flex items-center justify-end gap-3"><Button variant="outline" size="icon" aria-label="Página anterior" disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft className="size-4" /></Button><span className="text-sm">Página {page}</span><Button variant="outline" size="icon" aria-label="Próxima página" disabled={page * 20 >= lista.total} onClick={() => setPage(page + 1)}><ChevronRight className="size-4" /></Button></div>}
    </>}
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>Novo chamado</DialogTitle></DialogHeader>
      <form onSubmit={salvar} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="contato-nome">Nome do contato</Label><Input id="contato-nome" value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={120} disabled={busy || enviado} /></div>
        <div className="space-y-2"><Label htmlFor="contato-email">E-mail do contato</Label><Input id="contato-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={160} disabled={busy || enviado} /></div></div>
        <div className="space-y-2"><Label htmlFor="chamado-assunto">Assunto</Label><Input id="chamado-assunto" value={subject} onChange={(e) => setSubject(e.target.value)} required minLength={3} maxLength={200} disabled={busy || enviado} /></div>
        <div className="space-y-2"><Label>Prioridade</Label><Select value={priority} onValueChange={(value) => { if (value === "baixa" || value === "normal" || value === "alta" || value === "critica") setPriority(value); }} disabled={busy || enviado}><SelectTrigger aria-label="Prioridade"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="baixa">Baixa</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="alta">Alta</SelectItem><SelectItem value="critica">Crítica</SelectItem></SelectContent></Select></div>
        <div className="space-y-2"><Label htmlFor="chamado-descricao">Descrição</Label><Textarea id="chamado-descricao" rows={6} value={description} onChange={(e) => setDescription(e.target.value)} required minLength={3} maxLength={20000} disabled={busy || enviado} /></div>
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" disabled={busy || enviado}>{busy ? "Enviando…" : "Enviar chamado"}</Button></div>
      </form>
    </DialogContent></Dialog>
  </div>;
}