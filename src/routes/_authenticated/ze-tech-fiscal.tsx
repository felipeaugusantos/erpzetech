import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Upload } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { baixarArquivo } from "@/lib/cotacao";
import {
  LIMITE_LISTA_FISCAL,
  encerrarRegraFiscal,
  listarBaseFiscal,
  previaCargaFiscal,
  publicarCargaFiscal,
  type RegraBaseFiscal,
} from "@/lib/fiscal-base.functions";
import {
  COLUNAS_FISCAIS,
  ROTULO_ACAO,
  errosFiscais,
  lerPlanilhaFiscal,
  modeloFiscalCsv,
  paraEnvioFiscal,
  type EnvioFiscal,
  type LeituraFiscal,
  type ResultadoCargaFiscal,
} from "@/lib/fiscal-importacao";
import { decodificar, csvErros } from "@/lib/importacao";
import { useSaasOperador } from "@/lib/saas";

export const Route = createFileRoute("/_authenticated/ze-tech-fiscal")({
  head: () => ({
    meta: [
      { title: "Base fiscal (carga) — EZRA ERP" },
      {
        name: "description",
        content:
          "Carga e versionamento das regras fiscais por NCM que as empresas recebem como sugestão.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BaseFiscal,
});

const br = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");

const ROTULO_STATUS: Record<RegraBaseFiscal["status"], string> = {
  vigente: "Vigente",
  futura: "Futura",
  encerrada: "Encerrada",
  inativa: "Inativa",
};

const COR_ACAO: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  nova: "default",
  nova_versao: "default",
  igual: "secondary",
  erro: "destructive",
};

function resumoTributacao(p: RegraBaseFiscal["perfil"]) {
  const partes: string[] = [];
  if (p.cfop) partes.push(`CFOP ${p.cfop}`);
  if (p.cstIcms) partes.push(`CST ${p.cstIcms}`);
  if (p.csosn) partes.push(`CSOSN ${p.csosn}`);
  if (p.aliqIcms !== undefined) partes.push(`ICMS ${p.aliqIcms}%`);
  if (p.cstIbsCbs) partes.push(`IBS/CBS ${p.cstIbsCbs}`);
  return partes.join(" · ") || "—";
}

function BaseFiscal() {
  const qc = useQueryClient();
  const { data: operador, isLoading: carregandoAcesso } = useSaasOperador();
  const arquivo = useRef<HTMLInputElement>(null);
  const previaFn = useServerFn(previaCargaFiscal);
  const publicarFn = useServerFn(publicarCargaFiscal);
  const listarFn = useServerFn(listarBaseFiscal);
  const encerrarFn = useServerFn(encerrarRegraFiscal);

  const [fonte, setFonte] = useState("");
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [leitura, setLeitura] = useState<LeituraFiscal | null>(null);
  const [previa, setPrevia] = useState<{ resultado: ResultadoCargaFiscal; fonte: string } | null>(
    null,
  );
  const [confirmando, setConfirmando] = useState(false);

  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [apenasVigentes, setApenasVigentes] = useState(true);
  const [pagina, setPagina] = useState(0);
  const [encerrar, setEncerrar] = useState<{ regra: RegraBaseFiscal; fim: string } | null>(null);

  const lista = useQuery({
    queryKey: ["ze-tech-fiscal-base", buscaAplicada, apenasVigentes, pagina],
    enabled: operador === true,
    queryFn: () => listarFn({ data: { busca: buscaAplicada, apenasVigentes, pagina } }),
    staleTime: 0,
    retry: false,
  });

  const erros = leitura ? errosFiscais(leitura) : [];
  const envios: EnvioFiscal[] = leitura && erros.length === 0 ? paraEnvioFiscal(leitura) : [];
  const fonteLimpa = fonte.trim();

  const gerarPrevia = useMutation({
    mutationFn: () => previaFn({ data: { fonte: fonteLimpa, linhas: envios } }),
    onSuccess: (resultado) => setPrevia({ resultado, fonte: fonteLimpa }),
    onError: (e: Error) => toast.error(e.message),
  });

  const publicar = useMutation({
    mutationFn: () => publicarFn({ data: { fonte: fonteLimpa, linhas: envios } }),
    onSuccess: (r) => {
      if (!r.publicado) {
        setPrevia({ resultado: r, fonte: fonteLimpa });
        toast.error("Nada foi publicado: a carga tem linhas com erro.");
        return;
      }
      toast.success(
        `Carga publicada: ${r.resumo.novas} regra(s) nova(s) e ${r.resumo.novasVersoes} nova(s) versão(ões).`,
      );
      limpar();
      void qc.invalidateQueries({ queryKey: ["ze-tech-fiscal-base"] });
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setConfirmando(false),
  });

  const encerrarMut = useMutation({
    mutationFn: (p: { regraId: string; fim: string }) => encerrarFn({ data: p }),
    onSuccess: () => {
      toast.success("Regra encerrada");
      setEncerrar(null);
      void qc.invalidateQueries({ queryKey: ["ze-tech-fiscal-base"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function limpar() {
    setLeitura(null);
    setNomeArquivo(null);
    setPrevia(null);
    setFonte("");
  }

  async function lerArquivo(f: File) {
    const texto = decodificar(new Uint8Array(await f.arrayBuffer()));
    setNomeArquivo(f.name);
    setPrevia(null);
    setLeitura(lerPlanilhaFiscal(texto));
  }

  if (carregandoAcesso) {
    return <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>;
  }
  if (operador !== true) {
    return (
      <EmptyState
        title="Área exclusiva da equipe Ze Tech."
        description="Entre com um acesso da equipe para carregar a base fiscal."
      />
    );
  }

  const ocupado = gerarPrevia.isPending || publicar.isPending;
  const previaValida = previa !== null && previa.fonte === fonteLimpa;
  const resumo = previa?.resultado.resumo;
  const podePublicar =
    previaValida &&
    resumo !== undefined &&
    resumo.erros === 0 &&
    resumo.novas + resumo.novasVersoes > 0;
  const totalPaginas = Math.max(1, Math.ceil((lista.data?.total ?? 0) / LIMITE_LISTA_FISCAL));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Base fiscal (carga)"
        description="Regras de tributação por NCM que as empresas recebem como sugestão no cadastro de produtos. Vale para todas as empresas; cada empresa pode sobrescrever só para si."
      />

      <section className="panel space-y-4 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">Carregar planilha</h2>
          <Button
            variant="outline"
            onClick={() => baixarArquivo("modelo-base-fiscal.csv", modeloFiscalCsv())}
          >
            <Download className="mr-2 size-4" /> Baixar modelo
          </Button>
        </div>
        <p className="text-muted-foreground">
          A carga é <strong>tudo ou nada</strong>: com qualquer linha com erro, nada é publicado.
          Enviar de novo a mesma planilha não muda nada. Para mudar a tributação de uma regra já
          publicada, use <strong>outro nome de perfil</strong> e um início de vigência posterior: a
          versão anterior termina no dia anterior e continua no histórico.
        </p>
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer font-medium">Colunas da planilha</summary>
          <p className="mt-2 text-muted-foreground">
            Obrigatórias: <code>ncm</code> (2, 4, 6 ou 8 dígitos, o mais específico vence),{" "}
            <code>perfil</code> (nome) e <code>vigencia_inicio</code> (AAAA-MM-DD ou DD/MM/AAAA).
            Critérios opcionais, vazio = vale para todos: <code>cest</code>, <code>operacao</code>{" "}
            (venda, devolucao…), <code>regime</code> (normal, simples, mei) e{" "}
            <code>uf_destino</code>. Tributação (ao menos um campo): <code>cst_icms</code>,{" "}
            <code>csosn</code>, <code>cfop</code>, <code>aliq_icms</code>,{" "}
            <code>reducao_base_icms</code>, <code>mva_st</code>, <code>cst_pis</code>,{" "}
            <code>aliq_pis</code>, <code>cst_cofins</code>, <code>aliq_cofins</code>,{" "}
            <code>cst_ibs_cbs</code>, <code>cclasstrib</code>, <code>origem</code>. Linhas com o
            mesmo nome de perfil precisam ter exatamente os mesmos valores. Formate NCM, CEST e CST
            como texto para a planilha não tirar o zero à esquerda. Colunas:{" "}
            {COLUNAS_FISCAIS.length}.
          </p>
        </details>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="fiscal-fonte">Fonte da carga</Label>
            <Input
              id="fiscal-fonte"
              placeholder="Ex.: Planilha do contador, 11/2026"
              value={fonte}
              maxLength={200}
              onChange={(e) => setFonte(e.target.value)}
            />
          </div>
          <Button variant="outline" disabled={ocupado} onClick={() => arquivo.current?.click()}>
            <Upload className="mr-2 size-4" /> Escolher CSV
          </Button>
          <input
            ref={arquivo}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void lerArquivo(f);
            }}
          />
        </div>

        {leitura?.erroGeral && (
          <div role="alert" className="text-destructive">
            {leitura.erroGeral}
          </div>
        )}
        {leitura && !leitura.erroGeral && (
          <div className="space-y-3">
            <p>
              <strong>{nomeArquivo}</strong>: {leitura.linhas.length} linha(s) lida(s),{" "}
              <strong className={erros.length > 0 ? "text-destructive" : undefined}>
                {new Set(erros.map((e) => e.linha)).size} com erro
              </strong>
              .
            </p>
            {leitura.colunasIgnoradas.length > 0 && (
              <p className="text-muted-foreground">
                Colunas ignoradas (nome não reconhecido): {leitura.colunasIgnoradas.join(", ")}.
              </p>
            )}
            {erros.length > 0 ? (
              <div className="space-y-2">
                <div className="max-h-64 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Linha</TableHead>
                        <TableHead>Erro</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {erros.slice(0, 100).map((e, i) => (
                        <TableRow key={`${e.linha}-${i}`}>
                          <TableCell>{e.linha}</TableCell>
                          <TableCell>{e.mensagem}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {erros.length > 100 && (
                  <p className="text-muted-foreground">
                    Mostrando os 100 primeiros; baixe a lista completa.
                  </p>
                )}
                <Button
                  variant="outline"
                  onClick={() => baixarArquivo("erros-base-fiscal.csv", csvErros(erros))}
                >
                  <Download className="mr-2 size-4" /> Baixar erros (CSV)
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={ocupado || fonteLimpa.length < 3}
                  onClick={() => gerarPrevia.mutate()}
                >
                  {gerarPrevia.isPending ? "Calculando…" : "Ver prévia"}
                </Button>
                {fonteLimpa.length < 3 && (
                  <span className="text-muted-foreground">
                    Informe a fonte da carga para continuar.
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {previa && resumo && (
          <div className="space-y-3 border-t pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{resumo.novas} nova(s)</Badge>
              <Badge>{resumo.novasVersoes} nova(s) versão(ões)</Badge>
              <Badge variant="secondary">{resumo.iguais} sem mudança</Badge>
              <Badge variant={resumo.erros > 0 ? "destructive" : "secondary"}>
                {resumo.erros} com erro
              </Badge>
              {!previaValida && (
                <span className="text-muted-foreground">A fonte mudou: gere a prévia de novo.</span>
              )}
            </div>
            <div className="max-h-72 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Linha</TableHead>
                    <TableHead>O que acontece</TableHead>
                    <TableHead>Perfil</TableHead>
                    <TableHead>Detalhe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previa.resultado.linhas.slice(0, 300).map((l) => (
                    <TableRow key={l.linha}>
                      <TableCell>{l.linha}</TableCell>
                      <TableCell>
                        <Badge variant={COR_ACAO[l.acao] ?? "outline"}>{ROTULO_ACAO[l.acao]}</Badge>
                      </TableCell>
                      <TableCell>{l.perfil ?? "—"}</TableCell>
                      <TableCell>
                        {l.acao === "erro" ? l.motivo : l.versao ? `versão ${l.versao}` : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {previa.resultado.linhas.length > 300 && (
              <p className="text-muted-foreground">Mostrando as 300 primeiras linhas da prévia.</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={ocupado || !podePublicar} onClick={() => setConfirmando(true)}>
                Publicar carga
              </Button>
              <Button variant="outline" disabled={ocupado} onClick={limpar}>
                Descartar
              </Button>
              {resumo.erros === 0 && resumo.novas + resumo.novasVersoes === 0 && (
                <span className="text-muted-foreground">
                  Nada a publicar: a base já está igual à planilha.
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Base atual</h2>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setPagina(0);
            setBuscaAplicada(busca.trim());
          }}
        >
          <div className="w-full max-w-xs space-y-1">
            <Label htmlFor="fiscal-busca">Buscar por NCM ou nome do perfil</Label>
            <Input id="fiscal-busca" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <Button type="submit" variant="outline">
            Buscar
          </Button>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={apenasVigentes}
              onChange={(e) => {
                setPagina(0);
                setApenasVigentes(e.target.checked);
              }}
            />
            Só vigentes e futuras
          </label>
        </form>

        {lista.isPending ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : lista.isError ? (
          <div role="alert" className="text-destructive">
            {lista.error.message}
          </div>
        ) : lista.data.itens.length === 0 ? (
          <EmptyState
            title="Nenhuma regra na base."
            description="Baixe o modelo, preencha com o contador e carregue a planilha acima."
          />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {lista.data.total.toLocaleString("pt-BR")} regra(s).
            </p>
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>NCM</TableHead>
                    <TableHead>Critérios</TableHead>
                    <TableHead>Perfil</TableHead>
                    <TableHead>Tributação</TableHead>
                    <TableHead>Vigência</TableHead>
                    <TableHead>Versão</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lista.data.itens.map((r) => {
                    const criterios = [
                      r.cest && `CEST ${r.cest}`,
                      r.operacao,
                      r.regime,
                      r.ufDestino && `UF ${r.ufDestino}`,
                    ].filter(Boolean);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono">{r.ncmPrefixo}</TableCell>
                        <TableCell>
                          {criterios.length > 0 ? criterios.join(" · ") : "todos"}
                        </TableCell>
                        <TableCell>{r.perfilNome}</TableCell>
                        <TableCell>{resumoTributacao(r.perfil)}</TableCell>
                        <TableCell>
                          {br(r.vigenciaInicio)} a {r.vigenciaFim ? br(r.vigenciaFim) : "sem fim"}
                        </TableCell>
                        <TableCell>{r.versao}</TableCell>
                        <TableCell>
                          <Badge variant={r.status === "vigente" ? "default" : "secondary"}>
                            {ROTULO_STATUS[r.status]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {(r.status === "vigente" || r.status === "futura") && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setEncerrar({
                                  regra: r,
                                  fim: r.vigenciaFim ?? new Date().toISOString().slice(0, 10),
                                })
                              }
                            >
                              Encerrar
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pagina === 0}
                onClick={() => setPagina(pagina - 1)}
              >
                Anterior
              </Button>
              <span className="text-sm text-muted-foreground">
                Página {pagina + 1} de {totalPaginas}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={pagina + 1 >= totalPaginas}
                onClick={() => setPagina(pagina + 1)}
              >
                Próxima
              </Button>
            </div>
          </>
        )}
      </section>

      <AlertDialog
        open={confirmando}
        onOpenChange={(a) => !a && !publicar.isPending && setConfirmando(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publicar a carga?</AlertDialogTitle>
            <AlertDialogDescription>
              {resumo
                ? `${resumo.novas} regra(s) nova(s) e ${resumo.novasVersoes} nova(s) versão(ões) passam a valer para todas as empresas, que recebem como sugestão no cadastro de produtos. Versões anteriores terminam no dia anterior ao novo início e continuam no histórico.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={publicar.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={publicar.isPending}
              onClick={(e) => {
                e.preventDefault();
                publicar.mutate();
              }}
            >
              {publicar.isPending ? "Publicando…" : "Publicar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={encerrar !== null}
        onOpenChange={(a) => !a && !encerrarMut.isPending && setEncerrar(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar regra</AlertDialogTitle>
            <AlertDialogDescription>
              {encerrar
                ? `NCM ${encerrar.regra.ncmPrefixo}, perfil ${encerrar.regra.perfilNome}, versão ${encerrar.regra.versao}. A regra vale até o último dia informado e continua no histórico. Só é possível antecipar o fim, nunca estendê-lo.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {encerrar && (
            <div className="space-y-1">
              <Label htmlFor="fiscal-fim">Último dia de vigência</Label>
              <Input
                id="fiscal-fim"
                type="date"
                value={encerrar.fim}
                onChange={(e) => setEncerrar({ ...encerrar, fim: e.target.value })}
              />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={encerrarMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={encerrarMut.isPending || !encerrar?.fim}
              onClick={(e) => {
                e.preventDefault();
                if (encerrar) encerrarMut.mutate({ regraId: encerrar.regra.id, fim: encerrar.fim });
              }}
            >
              {encerrarMut.isPending ? "Encerrando…" : "Encerrar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
