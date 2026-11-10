import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { toast } from "sonner";

import {
  contarBackupClienteFn,
  lerPaginaBackupFn,
  listarClientesBackup,
  registrarBackupClienteFn,
} from "@/lib/backup-tenant.functions";
import {
  ROTULO_GRUPO,
  coletarBackup,
  linhaManifesto,
  montarManifesto,
  nomeArquivoBackup,
  type GrupoBackup,
  type TabelaContada,
} from "@/lib/backup-tenant";
import { labelRamo } from "@/lib/ramo";
import { useSaasOperador } from "@/lib/saas";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/ze-tech-backups")({
  head: () => ({
    meta: [
      { title: "Backup por cliente — ERP Ze Tech" },
      { name: "description", content: "Baixe o backup de um cliente, separado dos demais." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BackupsPorCliente,
});

type Alvo = { tenantId: string; nome: string };

async function compactar(partes: string[]): Promise<Blob> {
  const bruto = new Blob(partes, { type: "application/x-ndjson" });
  if (typeof CompressionStream === "undefined") return bruto;
  const fluxo = bruto.stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(fluxo).blob();
}

function salvarArquivo(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function BackupsPorCliente() {
  const { data: operador, isLoading: acessoCarregando } = useSaasOperador();
  const listar = useServerFn(listarClientesBackup);
  const contar = useServerFn(contarBackupClienteFn);
  const lerPagina = useServerFn(lerPaginaBackupFn);
  const registrar = useServerFn(registrarBackupClienteFn);
  const [busca, setBusca] = useState("");
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [desmarcados, setDesmarcados] = useState<Set<GrupoBackup>>(new Set());
  const [progresso, setProgresso] = useState<string | null>(null);
  const cancelar = useRef(false);

  const clientes = useQuery({
    queryKey: ["ze-tech-backups-clientes"],
    queryFn: () => listar(),
    enabled: operador === true,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  const contagem = useQuery({
    queryKey: ["ze-tech-backups-contagem", alvo?.tenantId],
    queryFn: () => contar({ data: { tenantId: alvo!.tenantId } }),
    enabled: operador === true && alvo !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  const grupos = useMemo(() => {
    const mapa = new Map<GrupoBackup, { tabelas: TabelaContada[]; linhas: number }>();
    for (const t of contagem.data?.tabelas ?? []) {
      if (t.linhas === 0) continue;
      const g = mapa.get(t.grupo) ?? { tabelas: [], linhas: 0 };
      g.tabelas.push(t);
      g.linhas += t.linhas;
      mapa.set(t.grupo, g);
    }
    return [...mapa.entries()];
  }, [contagem.data]);

  const baixar = useMutation({
    mutationFn: async () => {
      if (!alvo || !contagem.data) throw new Error("Aguarde a contagem terminar.");
      cancelar.current = false;
      const escolhidas = grupos
        .filter(([g]) => !desmarcados.has(g))
        .flatMap(([, g]) => g.tabelas.map((t) => t.tabela));
      if (escolhidas.length === 0) throw new Error("Escolha ao menos um grupo.");
      const { partes, tabelas } = await coletarBackup({
        tabelas: escolhidas,
        lerPagina: (tabela, cursor) =>
          lerPagina({ data: { tenantId: alvo.tenantId, tabela, cursor } }),
        aoProgredir: (p) =>
          setProgresso(`${p.tabela}: ${p.linhasTabela} linhas (${p.linhasTotal} no total)`),
        cancelado: () => cancelar.current,
      });
      const agora = new Date();
      const manifesto = montarManifesto({
        tenantId: alvo.tenantId,
        nome: contagem.data.nome,
        geradoEm: agora,
        geradoPor: "equipe_ze_tech",
        tabelas,
      });
      const blob = await compactar([linhaManifesto(manifesto), ...partes]);
      salvarArquivo(blob, nomeArquivoBackup(contagem.data.nome, agora));
      await registrar({
        data: {
          tenantId: alvo.tenantId,
          tabelas: tabelas.length,
          linhas: manifesto.total_linhas,
        },
      });
      return manifesto.total_linhas;
    },
    onSuccess: (linhas) => {
      toast.success("Backup baixado", { description: `${linhas} linhas exportadas.` });
      setProgresso(null);
      setAlvo(null);
    },
    onError: (e: Error) => {
      setProgresso(null);
      toast.error(e.message);
    },
  });

  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const todas = clientes.data?.clientes ?? [];
    return termo ? todas.filter((c) => c.nome.toLowerCase().includes(termo)) : todas;
  }, [clientes.data, busca]);

  if (acessoCarregando) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!operador)
    return (
      <EmptyState
        title="Área exclusiva da equipe Ze Tech"
        description="Esta conta não tem acesso ao painel do fabricante."
      />
    );

  return (
    <>
      <PageHeader
        title="Backup por cliente"
        actions={
          <Button asChild variant="outline">
            <Link to="/ze-tech">Painel de clientes</Link>
          </Button>
        }
      />
      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
        Gera um arquivo só com os dados de um cliente, separado dos demais. É um dado sensível:
        guarde em local protegido. Contas de acesso, chaves de integração e arquivos anexados não
        entram. Cada download fica registrado.
      </p>
      <div className="mb-4 max-w-sm">
        <Input
          placeholder="Buscar cliente"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          aria-label="Buscar cliente"
        />
      </div>
      {clientes.isPending ? (
        <p className="text-sm text-muted-foreground">Carregando clientes…</p>
      ) : clientes.isError ? (
        <div role="alert" className="text-destructive">
          {clientes.error.message}
        </div>
      ) : linhas.length === 0 ? (
        <EmptyState title="Nenhum cliente encontrado" description="Ajuste a busca." />
      ) : (
        <div className="overflow-x-auto rounded-md border bg-card">
          <Table className="min-w-[560px]">
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Segmento</TableHead>
                <TableHead className="w-44">
                  <span className="sr-only">Ação</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((c) => (
                <TableRow key={c.tenantId}>
                  <TableCell className="font-medium">
                    {c.nome}
                    {!c.ativo && (
                      <Badge variant="secondary" className="ml-2">
                        Inativo
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {c.ramos.length > 0 ? c.ramos.map(labelRamo).join(", ") : "—"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDesmarcados(new Set());
                        setAlvo({ tenantId: c.tenantId, nome: c.nome });
                      }}
                    >
                      <Download className="mr-1 size-4" /> Gerar backup
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={alvo !== null}
        onOpenChange={(o) => {
          if (o) return;
          if (baixar.isPending) cancelar.current = true;
          setAlvo(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Backup de {alvo?.nome}</DialogTitle>
            <DialogDescription>
              Escolha o que entra no arquivo. Só aparecem os grupos que têm dados.
            </DialogDescription>
          </DialogHeader>
          {contagem.isPending ? (
            <p className="text-sm text-muted-foreground">Contando os dados…</p>
          ) : contagem.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {contagem.error.message}
            </p>
          ) : grupos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Este cliente ainda não tem dados.</p>
          ) : (
            <ul className="space-y-2">
              {grupos.map(([g, info]) => (
                <li key={g} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id={`grupo-${g}`}
                    checked={!desmarcados.has(g)}
                    disabled={baixar.isPending}
                    onCheckedChange={(v) =>
                      setDesmarcados((atual) => {
                        const novo = new Set(atual);
                        if (v === true) novo.delete(g);
                        else novo.add(g);
                        return novo;
                      })
                    }
                  />
                  <label htmlFor={`grupo-${g}`} className="flex-1">
                    {ROTULO_GRUPO[g]}
                  </label>
                  <span className="text-muted-foreground">
                    {info.linhas} linhas em {info.tabelas.length} tabelas
                  </span>
                </li>
              ))}
            </ul>
          )}
          {progresso && <p className="text-xs text-muted-foreground">{progresso}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (baixar.isPending) cancelar.current = true;
                else setAlvo(null);
              }}
            >
              {baixar.isPending ? "Cancelar" : "Fechar"}
            </Button>
            <Button
              disabled={baixar.isPending || contagem.isPending || grupos.length === 0}
              onClick={() => baixar.mutate()}
            >
              {baixar.isPending ? "Gerando…" : "Baixar backup"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
