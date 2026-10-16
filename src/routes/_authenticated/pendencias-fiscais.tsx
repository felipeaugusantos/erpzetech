import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { brl, dateTimeBR } from "@/lib/format";
import {
  MINUTOS_SEM_RETORNO,
  ORDEM_PENDENCIA,
  ROTULO_EVENTO,
  ROTULO_MODELO,
  ROTULO_PENDENCIA,
  classificarNota,
  contarPorTipo,
  filtroNotasPendentes,
  rotuloProvedor,
  type TipoPendencia,
} from "@/lib/pendencias-fiscais";

export const Route = createFileRoute("/_authenticated/pendencias-fiscais")({
  head: () => ({
    meta: [
      { title: "Pendências fiscais — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Notas rejeitadas, em contingência ou sem retorno da Sefaz, e eventos de pagamento que não terminaram.",
      },
    ],
  }),
  component: PendenciasFiscais,
});

const COR_TIPO: Record<TipoPendencia, string> = {
  rejeitada: "bg-destructive/15 text-destructive",
  contingencia: "bg-warning/15 text-warning",
  sem_retorno: "bg-info/15 text-info",
  rascunho: "bg-muted text-muted-foreground",
};

const PAPEIS_NOTAS = ["administrador", "gestor", "financeiro", "vendedor", "caixa"];
const PAPEIS_EVENTOS = ["administrador", "gestor", "financeiro"];

function PendenciasFiscais() {
  const { data: sessao } = useSessionData();
  const papeis = sessao?.roles ?? [];
  const veNotas = papeis.some((r) => PAPEIS_NOTAS.includes(r));
  const veEventos = papeis.some((r) => PAPEIS_EVENTOS.includes(r));

  const {
    data: notas = [],
    isLoading: carregandoNotas,
    error: erroNotas,
  } = useQuery({
    queryKey: ["pendencias-fiscais-notas"],
    enabled: veNotas,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nfe")
        .select(
          "id, modelo, numero, serie, situacao, valor_total, mensagem, pendencias, tentativas, updated_at, transmitida_em",
        )
        .or(filtroNotasPendentes(new Date()))
        .order("updated_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });

  const {
    data: eventos = [],
    isLoading: carregandoEventos,
    error: erroEventos,
  } = useQuery({
    queryKey: ["pendencias-fiscais-eventos"],
    enabled: veEventos,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("eventos_pendentes");
      if (error) throw error;
      return data ?? [];
    },
  });

  const agora = new Date();
  const pendentes = notas
    .map((n) => ({ nota: n, tipo: classificarNota(n, agora) }))
    .filter((x): x is { nota: (typeof notas)[number]; tipo: TipoPendencia } => x.tipo !== null)
    .sort(
      (a, b) =>
        ORDEM_PENDENCIA.indexOf(a.tipo) - ORDEM_PENDENCIA.indexOf(b.tipo) ||
        b.nota.updated_at.localeCompare(a.nota.updated_at),
    );
  const totais = contarPorTipo(notas, agora);

  if (sessao && !veNotas) {
    return (
      <div>
        <PageHeader title="Pendências fiscais" />
        <EmptyState
          title="Acesso restrito"
          description="Seu perfil não consulta as pendências fiscais."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Pendências fiscais"
        description="O que precisa de atenção: notas rejeitadas, em contingência ou sem retorno da Sefaz, e eventos de Pix, boleto e maquininha que não terminaram."
      />

      <Tabs defaultValue="notas">
        <TabsList>
          <TabsTrigger value="notas">Notas ({pendentes.length})</TabsTrigger>
          {veEventos ? (
            <TabsTrigger value="eventos">Pagamentos ({eventos.length})</TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="notas" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ORDEM_PENDENCIA.map((tipo) => (
              <div key={tipo} className="panel p-4">
                <p className="text-xs text-muted-foreground">{ROTULO_PENDENCIA[tipo]}</p>
                <p className="text-2xl font-semibold text-numeric">{totais[tipo]}</p>
              </div>
            ))}
          </div>

          {erroNotas ? (
            <EmptyState
              title="Não foi possível carregar as notas"
              description={erroNotas instanceof Error ? erroNotas.message : "Tente de novo."}
            />
          ) : carregandoNotas ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : pendentes.length === 0 ? (
            <EmptyState
              title="Nenhuma nota pendente"
              description={`Notas enviadas aparecem aqui se ficarem mais de ${MINUTOS_SEM_RETORNO} minutos sem retorno da Sefaz.`}
            />
          ) : (
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Situação</TableHead>
                    <TableHead>Nota</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>O que houve</TableHead>
                    <TableHead className="whitespace-nowrap">Atualizada em</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendentes.map(({ nota, tipo }) => (
                    <TableRow key={nota.id} className="align-top">
                      <TableCell>
                        <Badge className={COR_TIPO[tipo]}>{ROTULO_PENDENCIA[tipo]}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        <Link to="/nfe" className="underline-offset-2 hover:underline">
                          {ROTULO_MODELO[nota.modelo] ?? nota.modelo}{" "}
                          {nota.numero ? `nº ${nota.numero} · série ${nota.serie}` : "sem número"}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right text-numeric text-sm">
                        {brl(nota.valor_total)}
                      </TableCell>
                      <TableCell className="max-w-md text-sm">
                        {nota.pendencias.length > 0 ? (
                          <ul className="list-disc pl-4">
                            {nota.pendencias.map((p) => (
                              <li key={p}>{p}</li>
                            ))}
                          </ul>
                        ) : (
                          (nota.mensagem ?? "Sem detalhes do emissor.")
                        )}
                        {nota.tentativas > 0 ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {nota.tentativas} tentativa(s) de envio
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {dateTimeBR(nota.updated_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {veEventos ? (
          <TabsContent value="eventos">
            {erroEventos ? (
              <EmptyState
                title="Não foi possível carregar os eventos"
                description={erroEventos instanceof Error ? erroEventos.message : "Tente de novo."}
              />
            ) : carregandoEventos ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : eventos.length === 0 ? (
              <EmptyState
                title="Nenhum evento pendente"
                description="Pagamentos recebidos do banco ou da maquininha que falharam, foram ignorados ou ficaram sem resposta aparecem aqui."
              />
            ) : (
              <div className="panel overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Situação</TableHead>
                      <TableHead>Origem</TableHead>
                      <TableHead>Identificação</TableHead>
                      <TableHead>Erro</TableHead>
                      <TableHead className="whitespace-nowrap">Recebido em</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {eventos.map((e) => (
                      <TableRow key={e.id} className="align-top">
                        <TableCell>
                          <Badge
                            className={
                              e.status === "erro"
                                ? "bg-destructive/15 text-destructive"
                                : "bg-info/15 text-info"
                            }
                          >
                            {ROTULO_EVENTO[e.status] ?? e.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{rotuloProvedor(e.provedor)}</TableCell>
                        <TableCell className="break-all text-sm">{e.event_id}</TableCell>
                        <TableCell className="max-w-md text-sm">
                          {e.erro ?? "—"}
                          {e.tentativas > 1 ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {e.tentativas} tentativas
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {dateTimeBR(e.recebido_em)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
