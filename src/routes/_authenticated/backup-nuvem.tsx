import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Cloud, RefreshCw, Pause, Play, Unplug, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { estadoBackupDrive, iniciarBackupDrive, completarBackupDrive, alterarBackupDrive } from "@/lib/backup-drive.functions";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const options = queryOptions({ queryKey: ["backup-drive"], queryFn: () => estadoBackupDrive(), staleTime: 0 });
export const Route = createFileRoute("/_authenticated/backup-nuvem")({
  head: () => ({ meta: [
    { title: "Backup no Google Drive — ERP Ze Tech" },
    { name: "description", content: "Backups noturnos e retenção das cópias da sua empresa no Google Drive." },
    { property: "og:title", content: "Backup no Google Drive — ERP Ze Tech" },
    { property: "og:description", content: "Conexão e histórico de backups da sua empresa." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(options), component: BackupNuvem,
});
function aguardar(popup: Window): Promise<{ code: string; nonce: string }> {
  return new Promise((resolve, reject) => {
    const limpar = () => { window.removeEventListener("message", receber); clearInterval(timer); clearTimeout(timeout); };
    const receber = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== popup || event.data?.type !== "erpBackupDriveOAuth" || event.data?.connectorId !== "google_drive") return;
      limpar();
      if (typeof event.data.code !== "string" || typeof event.data.nonce !== "string") return reject(new Error("A conexão não foi autorizada para backups automáticos."));
      resolve({ code: event.data.code, nonce: event.data.nonce });
    };
    window.addEventListener("message", receber);
    const timer = window.setInterval(() => { if (popup.closed) { limpar(); reject(new Error("Conexão cancelada.")); } }, 500);
    const timeout = window.setTimeout(() => { limpar(); popup.close(); reject(new Error("Conexão expirada.")); }, 600000);
  });
}
function BackupNuvem() {
  const { data, refetch } = useSuspenseQuery(options);
  const start = useServerFn(iniciarBackupDrive);
  const complete = useServerFn(completarBackupDrive);
  const change = useServerFn(alterarBackupDrive);
  const [busy, setBusy] = useState(false);
  async function conectar() {
    const popup = window.open("", "erp-drive", "width=600,height=720");
    if (!popup) { toast.error("Permita abrir janelas para conectar o Google Drive."); return; }
    setBusy(true);
    try {
      const { authorizationUrl } = await start();
      const done = aguardar(popup);
      popup.location.href = authorizationUrl;
      const result = await done;
      await complete({ data: result });
      await refetch(); toast.success("Google Drive conectado; backups noturnos ativados.");
    } catch (e) { popup.close(); toast.error(e instanceof Error ? e.message : "Falha na conexão."); }
    finally { setBusy(false); }
  }
  async function alterar(acao: "ativar" | "pausar" | "desconectar") {
    if (acao === "desconectar" && !window.confirm("Desconectar o Google Drive? As cópias já enviadas serão preservadas.")) return;
    setBusy(true);
    try { await change({ data: { acao } }); await refetch(); toast.success("Configuração atualizada."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao salvar."); }
    finally { setBusy(false); }
  }
  const config = data.config;
  return <div className="space-y-6">
    <PageHeader title="Backup na nuvem" description="Google Drive" />
    <section className="border-b border-border pb-6 space-y-4">
      <div className="flex items-center gap-3"><Cloud className="h-7 w-7 text-primary" /><h2 className="text-xl font-semibold">Google Drive</h2><Badge variant={config?.ativo ? "default" : "secondary"}>{config?.reconectar ? "Reconexão necessária" : config?.ativo ? "Ativo" : config?.pastaId ? "Pausado" : "Não conectado"}</Badge></div>
      <dl className="grid gap-4 sm:grid-cols-3"><div><dt className="text-muted-foreground text-sm">Execução · Brasília</dt><dd>2h às 4h45 · diariamente</dd></div><div><dt className="text-muted-foreground text-sm">Retenção</dt><dd>{data.politica.diarios} diárias · {data.politica.semanais} semanais · {data.politica.mensais} mensais</dd></div><div><dt className="text-muted-foreground text-sm">Conteúdo</dt><dd>Dados da empresa · sem senhas ou anexos</dd></div></dl>
      {config?.erro && <p role="alert" className="text-destructive">{config.erro}</p>}
      <div className="flex flex-wrap gap-2">
        {(!config || config.propria) && <Button disabled={busy} onClick={conectar}><Cloud />{config?.pastaId ? "Reconectar Google Drive" : "Conectar Google Drive"}</Button>}
        {config?.pastaId && config.propria && <><Button variant="outline" disabled={busy || config.reconectar} onClick={() => alterar(config.ativo ? "pausar" : "ativar")}>{config.ativo ? <Pause /> : <Play />}{config.ativo ? "Pausar" : "Ativar"}</Button><Button variant="outline" disabled={busy} onClick={() => alterar("desconectar")}><Unplug />Desconectar</Button></>}
        {config?.pastaId && <Button variant="outline" asChild><a href={`https://drive.google.com/drive/folders/${encodeURIComponent(config.pastaId)}`} target="_blank" rel="noreferrer"><ExternalLink />Abrir pasta</a></Button>}
        <Button variant="ghost" disabled={busy} onClick={() => refetch()}><RefreshCw />Atualizar</Button>
      </div>
    </section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Histórico de cópias</h2>
      <Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Situação</TableHead><TableHead>Tamanho</TableHead><TableHead>Ocorrência</TableHead></TableRow></TableHeader><TableBody>{data.execucoes.map(e => <TableRow key={e.dia}><TableCell>{e.dia.split("-").reverse().join("/")}</TableCell><TableCell>{({ pendente: "Em envio", concluido: "Enviado e conferido", erro: "Falha", expirado: "Expirado" } as Record<string, string>)[e.situacao]}</TableCell><TableCell>{e.tamanho === null ? "—" : `${(e.tamanho / 1024 / 1024).toFixed(2)} MB`}</TableCell><TableCell className="max-w-64 whitespace-normal">{e.erro ?? "—"}</TableCell></TableRow>)}{data.execucoes.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Nenhuma cópia enviada ao Google Drive.</TableCell></TableRow>}</TableBody></Table>
    </section>
  </div>;
}