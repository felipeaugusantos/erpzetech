import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { listarClientesBackup } from "@/lib/backup-tenant.functions";
import {
  conferirIdsFn,
  estadoPontoDeSegurancaFn,
  gerarPontoDeSegurancaFn,
  restaurarLoteFn,
} from "@/lib/backup-restauracao.functions";
import {
  LINHAS_POR_LOTE_RESTAURACAO,
  MOTIVO_NAO_RESTAURAVEL,
  confirmacaoConfere,
  emLotes,
  lerArquivoBackup,
  montarPlano,
  tabelaRestauravel,
  type ArquivoLido,
  type PlanoRestauracao,
} from "@/lib/backup-restauracao";
import { useSaasOperador } from "@/lib/saas";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/ze-tech-restauracao")({
  head: () => ({
    meta: [
      { title: "Restauração de backup — ERP Ze Tech" },
      {
        name: "description",
        content: "Devolve a um cliente os cadastros que faltam, a partir de um backup dele.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RestauracaoDeBackup,
});

async function textoDoArquivo(arquivo: File): Promise<string> {
  const gz = /\.gz$/i.test(arquivo.name);
  if (gz && typeof DecompressionStream !== "undefined") {
    const fluxo = arquivo.stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(fluxo).text();
  }
  return arquivo.text();
}

type Conferencia = { arquivo: ArquivoLido; plano: PlanoRestauracao | null };

function RestauracaoDeBackup() {
  const { data: operador, isLoading: acessoCarregando } = useSaasOperador();
  const listar = useServerFn(listarClientesBackup);
  const conferirIds = useServerFn(conferirIdsFn);
  const estadoPonto = useServerFn(estadoPontoDeSegurancaFn);
  const gerarPonto = useServerFn(gerarPontoDeSegurancaFn);
  const restaurarLote = useServerFn(restaurarLoteFn);

  const [tenantId, setTenantId] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [conferencia, setConferencia] = useState<Conferencia | null>(null);
  const [confirmacao, setConfirmacao] = useState("");
  const [progresso, setProgresso] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const parar = useRef(false);

  const clientes = useQuery({
    queryKey: ["ze-tech-restauracao-clientes"],
    queryFn: () => listar(),
    enabled: operador === true,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const cliente = clientes.data?.clientes.find((c) => c.tenantId === tenantId) ?? null;

  const ponto = useQuery({
    queryKey: ["ze-tech-restauracao-ponto", tenantId],
    queryFn: () => estadoPonto({ data: { tenantId } }),
    enabled: operador === true && tenantId !== "",
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  const conferir = useMutation({
    mutationFn: async (): Promise<Conferencia> => {
      if (!arquivo || !tenantId) throw new Error("Escolha o cliente e o arquivo.");
      const lido = lerArquivoBackup(await textoDoArquivo(arquivo), tenantId);
      if (lido.problemas.length > 0) return { arquivo: lido, plano: null };
      // compara, tabela por tabela, os ids do arquivo com o que existe hoje (nada é gravado)
      const existentes = new Map<string, Set<string>>();
      for (const [tabela, linhas] of lido.registros) {
        const ids = linhas.map((l) => l["id"]).filter((i): i is string => typeof i === "string");
        if (ids.length === 0) continue;
        const vivos = new Set<string>();
        if (!tabelaRestauravel(tabela)) continue; // esta versão não restaura essa tabela
        for (const lote of emLotes(ids, 1000)) {
          const r = await conferirIds({ data: { tenantId, tabela, ids: lote } });
          r.existentes.forEach((i) => vivos.add(i));
        }
        existentes.set(tabela, vivos);
      }
      return { arquivo: lido, plano: montarPlano(lido, existentes) };
    },
    onSuccess: (c) => {
      setConferencia(c);
      setResultado(null);
      setConfirmacao("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const criarPonto = useMutation({
    mutationFn: () => gerarPonto({ data: { tenantId } }),
    onSuccess: () => {
      toast.success("Ponto de segurança pronto");
      void ponto.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const restaurar = useMutation({
    mutationFn: async () => {
      const plano = conferencia?.plano;
      if (!plano) throw new Error("Confira o arquivo antes.");
      parar.current = false;
      let inseridas = 0;
      for (const t of plano.tabelas) {
        for (const lote of emLotes(t.ausentes, LINHAS_POR_LOTE_RESTAURACAO)) {
          if (parar.current)
            throw new Error(`Parado pela equipe. Já voltaram ${inseridas} linhas.`);
          setProgresso(`${t.tabela}: ${inseridas} linhas devolvidas até agora`);
          const r = await restaurarLote({ data: { tenantId, tabela: t.tabela, registros: lote } });
          inseridas += r.inseridas;
        }
      }
      return inseridas;
    },
    onSuccess: (n) => {
      setProgresso(null);
      setResultado(
        `${n} linhas devolvidas ao cliente. Confira o arquivo de novo para ver o que ainda falta.`,
      );
      setConferencia(null);
      toast.success("Restauração concluída");
    },
    onError: (e: Error) => {
      setProgresso(null);
      setResultado(
        `Parou com erro: ${e.message}. O que já voltou continua no cliente; nada foi apagado ou sobrescrito, e dá para conferir e tentar de novo.`,
      );
      setConferencia(null);
      toast.error(e.message);
    },
  });

  const podeRestaurar = useMemo(
    () =>
      !!cliente &&
      !!conferencia?.plano &&
      conferencia.plano.totalAusentes > 0 &&
      ponto.data?.valido === true &&
      confirmacaoConfere(confirmacao, cliente.nome),
    [cliente, conferencia, ponto.data, confirmacao],
  );

  if (acessoCarregando) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!operador)
    return (
      <EmptyState
        title="Área exclusiva da equipe Ze Tech"
        description="Esta conta não tem acesso ao painel do fabricante."
      />
    );

  const plano = conferencia?.plano ?? null;
  return (
    <>
      <PageHeader
        title="Restauração de backup"
        actions={
          <Button asChild variant="outline">
            <Link to="/ze-tech-backups">Backups por cliente</Link>
          </Button>
        }
      />
      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
        Devolve ao cliente os cadastros que faltam hoje e constam de um backup dele. Só insere: o
        que já existe não é alterado nem apagado. {MOTIVO_NAO_RESTAURAVEL}
      </p>

      <div className="mb-4 grid max-w-xl gap-3">
        <label className="grid gap-1 text-sm">
          Cliente
          <select
            className="h-9 rounded-md border bg-background px-2"
            value={tenantId}
            onChange={(e) => {
              setTenantId(e.target.value);
              setConferencia(null);
              setResultado(null);
            }}
          >
            <option value="">Escolha o cliente</option>
            {(clientes.data?.clientes ?? []).map((c) => (
              <option key={c.tenantId} value={c.tenantId}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Arquivo de backup (.ndjson.gz)
          <Input
            type="file"
            accept=".gz,.ndjson,.json"
            onChange={(e) => {
              setArquivo(e.target.files?.[0] ?? null);
              setConferencia(null);
              setResultado(null);
            }}
          />
        </label>
        <div>
          <Button
            disabled={!tenantId || !arquivo || conferir.isPending}
            onClick={() => conferir.mutate()}
          >
            {conferir.isPending ? "Conferindo…" : "Conferir arquivo (não grava nada)"}
          </Button>
        </div>
      </div>

      {resultado && (
        <p role="status" className="mb-4 max-w-3xl rounded-md border bg-card p-3 text-sm">
          {resultado}
        </p>
      )}

      {conferencia && conferencia.arquivo.problemas.length > 0 && (
        <div
          role="alert"
          className="mb-4 max-w-3xl rounded-md border border-destructive p-3 text-sm"
        >
          <p className="mb-1 font-medium text-destructive">
            Arquivo recusado. Nada será restaurado a partir dele.
          </p>
          <ul className="list-disc pl-5">
            {conferencia.arquivo.problemas.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {plano && (
        <>
          <p className="mb-2 text-sm">
            Arquivo de {conferencia?.arquivo.manifesto?.gerado_em.slice(0, 10)} com{" "}
            {conferencia?.arquivo.totalLinhas} linhas.{" "}
            {plano.totalAusentes === 0
              ? "Nenhum cadastro restaurável está faltando."
              : `${plano.totalAusentes} linhas de cadastro faltam hoje e podem voltar.`}
          </p>
          <div className="mb-4 max-w-3xl overflow-x-auto rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tabela</TableHead>
                  <TableHead className="text-right">No arquivo</TableHead>
                  <TableHead className="text-right">Já existem</TableHead>
                  <TableHead className="text-right">Faltam</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plano.tabelas.map((t) => (
                  <TableRow key={t.tabela}>
                    <TableCell className="font-medium">{t.tabela}</TableCell>
                    <TableCell className="text-right">{t.noArquivo}</TableCell>
                    <TableCell className="text-right">{t.jaExistem}</TableCell>
                    <TableCell className="text-right">{t.ausentes.length}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {plano.ignoradas.length > 0 && (
            <p className="mb-4 max-w-3xl text-xs text-muted-foreground">
              Não restauradas por esta versão:{" "}
              {plano.ignoradas.map((i) => `${i.tabela} (${i.linhas})`).join(", ")}.
            </p>
          )}

          {plano.totalAusentes > 0 && cliente && (
            <div className="grid max-w-xl gap-3 rounded-md border bg-card p-4">
              <div className="text-sm">
                <p className="font-medium">1. Ponto de segurança</p>
                <p className="text-muted-foreground">
                  Antes de restaurar, é preciso ter um backup do estado atual (de até 24 horas).{" "}
                  {ponto.data?.valido ? "Já existe um." : "Ainda não existe."}
                </p>
                {!ponto.data?.valido && (
                  <Button
                    className="mt-2"
                    variant="outline"
                    disabled={criarPonto.isPending}
                    onClick={() => criarPonto.mutate()}
                  >
                    {criarPonto.isPending ? "Gerando…" : "Gerar ponto de segurança agora"}
                  </Button>
                )}
              </div>
              <label className="grid gap-1 text-sm">
                2. Digite o nome do cliente para confirmar: <strong>{cliente.nome}</strong>
                <Input value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} />
              </label>
              {progresso && <p className="text-xs text-muted-foreground">{progresso}</p>}
              <div className="flex gap-2">
                <Button
                  disabled={!podeRestaurar || restaurar.isPending}
                  onClick={() => restaurar.mutate()}
                >
                  {restaurar.isPending
                    ? "Restaurando…"
                    : `Restaurar ${plano.totalAusentes} linhas que faltam`}
                </Button>
                {restaurar.isPending && (
                  <Button variant="outline" onClick={() => (parar.current = true)}>
                    Parar
                  </Button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
