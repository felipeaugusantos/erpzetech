import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw, History } from "lucide-react";
import { toast } from "sonner";
import { estadoBackupDrive } from "@/lib/backup-drive.functions";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const options = queryOptions({
  queryKey: ["backup-drive"],
  queryFn: () => estadoBackupDrive(),
  staleTime: 0,
});
const situacoes: Record<string, string> = {
  pendente: "Em envio",
  concluido: "Enviado e conferido",
  erro: "Falha no envio",
  expirado: "Removido pela retenção",
};
const dataEnvio = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "medium",
});
const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

export const Route = createFileRoute("/_authenticated/backup-historico")({
  head: () => ({
    meta: [
      { title: "Histórico de backups no Google Drive — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Confira a data, a hora de envio, o tamanho e a situação dos backups da sua empresa no Google Drive.",
      },
      { property: "og:title", content: "Histórico de backups no Google Drive — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Histórico de envios e tamanhos das cópias de segurança da sua empresa.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(options),
  component: HistoricoBackups,
});

function HistoricoBackups() {
  const { data, refetch, isFetching } = useSuspenseQuery(options);
  const [situacao, setSituacao] = useState("todas");
  const execucoes = data.execucoes.filter((e) => situacao === "todas" || e.situacao === situacao);
  async function atualizar() {
    const result = await refetch();
    if (result.error) toast.error("Não foi possível atualizar o histórico. Tente novamente.");
  }
  return (
    <div className="space-y-6 min-w-0">
      <PageHeader title="Histórico de backups" description="Google Drive · Horário de Brasília" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" asChild>
          <Link to="/backup-nuvem">
            <ArrowLeft />
            Backup na nuvem
          </Link>
        </Button>
        <Button variant="outline" disabled={isFetching} onClick={atualizar}>
          <RefreshCw className={isFetching ? "motion-safe:animate-spin" : ""} />
          Atualizar
        </Button>
      </div>
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <p className="text-sm text-muted-foreground">
            Últimas {data.execucoes.length} execuções · até 60 registros
          </p>
          <Select value={situacao} onValueChange={setSituacao}>
            <SelectTrigger aria-label="Filtrar por situação" className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as situações</SelectItem>
              {Object.entries(situacoes).map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {data.execucoes.length === 0 ? (
          <div className="py-12 text-center space-y-3">
            <History className="mx-auto h-9 w-9 text-muted-foreground" />
            <p className="font-medium">Nenhum backup registrado no Google Drive.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Backup do dia</TableHead>
                <TableHead>Enviado em · Brasília</TableHead>
                <TableHead className="text-right">Tamanho</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Ocorrência</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {execucoes.map((e) => (
                <TableRow key={e.dia}>
                  <TableCell className="whitespace-nowrap">
                    {e.dia.split("-").reverse().join("/")}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {e.concluido_em ? (
                      <time dateTime={e.concluido_em}>
                        {dataEnvio.format(new Date(e.concluido_em))}
                      </time>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {e.tamanho === null ? (
                      "—"
                    ) : (
                      <>
                        <span>
                          {e.tamanho < 1048576
                            ? `${numero.format(e.tamanho / 1024)} KB`
                            : `${numero.format(e.tamanho / 1048576)} MB`}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {numero.format(e.tamanho)} bytes
                        </span>
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        e.situacao === "erro"
                          ? "destructive"
                          : e.situacao === "concluido"
                            ? "default"
                            : "secondary"
                      }
                      className="whitespace-nowrap"
                    >
                      {situacoes[e.situacao] ?? e.situacao}
                    </Badge>
                  </TableCell>
                  <TableCell className="min-w-40 max-w-80 whitespace-normal break-words">
                    {e.erro ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
              {execucoes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    Nenhum registro nesta situação.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
