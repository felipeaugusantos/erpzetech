import { Fragment, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bug, CheckCircle2, EyeOff, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { dateTimeBR, num } from "@/lib/format";
import { useSaasOperador } from "@/lib/saas";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export const Route = createFileRoute("/_authenticated/ze-tech-erros")({
  head: () => ({
    meta: [
      { title: "Erros do sistema — EZRA" },
      {
        name: "description",
        content:
          "Painel da equipe EZRA com os erros do navegador e do servidor, agrupados, com contagem e cliente afetado.",
      },
    ],
  }),
  component: ErrosZeTech,
});

type Situacao = "aberto" | "resolvido" | "ignorado";

function ErrosZeTech() {
  const { data: operador, isLoading: carregandoAcesso } = useSaasOperador();
  const [situacao, setSituacao] = useState<Situacao | "todos">("aberto");
  const [aberto, setAberto] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: erros = [], isLoading } = useQuery({
    queryKey: ["saas-erros", situacao],
    enabled: operador === true,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("saas_erros_listar", {
        p_situacao: situacao,
        p_limite: 200,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const mudar = useMutation({
    mutationFn: async (v: { id: string; situacao: Situacao }) => {
      const { error } = await supabase.rpc("saas_erro_situacao", {
        p_id: v.id,
        p_situacao: v.situacao,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saas-erros"] }),
    onError: () => toast.error("Não foi possível mudar a situação do erro."),
  });

  if (carregandoAcesso) {
    return <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>;
  }
  if (operador !== true) {
    return (
      <EmptyState
        title="Área exclusiva da equipe EZRA."
        description="Entre com um acesso da equipe para ver os erros do sistema."
      />
    );
  }

  const umDiaAtras = Date.now() - 24 * 60 * 60 * 1000;
  const novosHoje = erros.filter((e) => new Date(e.primeira_vez).getTime() > umDiaAtras).length;
  const totalOcorrencias = erros.reduce((a, e) => a + Number(e.ocorrencias ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Erros do sistema"
        description="Erros do navegador e do servidor, agrupados por defeito. O texto chega sem e-mail, documento, telefone nem token."
        actions={
          <Select value={situacao} onValueChange={(v) => setSituacao(v as Situacao | "todos")}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="aberto">Abertos</SelectItem>
              <SelectItem value="resolvido">Resolvidos</SelectItem>
              <SelectItem value="ignorado">Ignorados</SelectItem>
              <SelectItem value="todos">Todos</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Defeitos na lista" value={num(erros.length, 0)} icon={Bug} />
        <StatCard label="Novos nas últimas 24 h" value={num(novosHoje, 0)} tone="accent" />
        <StatCard label="Ocorrências somadas" value={num(totalOcorrencias, 0)} />
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : erros.length === 0 ? (
        <EmptyState
          title="Nenhum erro nesta lista."
          description="Quando o sistema falhar no navegador ou no servidor, o defeito aparece aqui."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Erro</TableHead>
                <TableHead>Onde</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Vezes</TableHead>
                <TableHead>Última vez</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {erros.map((e) => (
                <Fragment key={e.id}>
                  <TableRow>
                    <TableCell className="max-w-md">
                      <button
                        type="button"
                        className="text-left font-medium underline-offset-4 hover:underline"
                        onClick={() => setAberto(aberto === e.id ? null : e.id)}
                      >
                        {e.mensagem}
                      </button>
                      <div className="mt-1">
                        <Badge variant="outline">
                          {e.origem === "servidor" ? "Servidor" : "Navegador"}
                        </Badge>
                        {e.situacao !== "aberto" && (
                          <Badge variant="secondary" className="ml-1">
                            {e.situacao === "resolvido" ? "Resolvido" : "Ignorado"}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{e.rota ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{e.cliente ?? "—"}</TableCell>
                    <TableCell className="text-right text-numeric font-semibold">
                      {num(Number(e.ocorrencias ?? 0), 0)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {dateTimeBR(e.ultima_vez)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {e.situacao === "aberto" ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={mudar.isPending}
                            onClick={() => mudar.mutate({ id: e.id, situacao: "resolvido" })}
                          >
                            <CheckCircle2 className="mr-1 size-4" /> Resolver
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={mudar.isPending}
                            onClick={() => mudar.mutate({ id: e.id, situacao: "ignorado" })}
                          >
                            <EyeOff className="mr-1 size-4" /> Ignorar
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={mudar.isPending}
                          onClick={() => mudar.mutate({ id: e.id, situacao: "aberto" })}
                        >
                          <RotateCcw className="mr-1 size-4" /> Reabrir
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                  {aberto === e.id && (
                    <TableRow>
                      <TableCell colSpan={6} className="bg-muted/40">
                        <p className="text-xs text-muted-foreground">
                          Primeira vez: {dateTimeBR(e.primeira_vez)}
                          {e.navegador ? ` · ${e.navegador}` : ""}
                        </p>
                        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">
                          {e.stack ?? "Sem detalhes técnicos."}
                        </pre>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
