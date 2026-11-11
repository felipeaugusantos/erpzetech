import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { RegraFiscalDialog } from "@/components/app/RegraFiscalDialog";
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
import {
  ROTULO_STATUS_REGRA,
  dataBr,
  descreverCriterios,
  resumoDoPerfil,
  validarMotivo,
  type RegraEmpresa,
  type RegraGlobalVista,
} from "@/lib/fiscal-empresa";
import {
  LIMITE_PAGINA_FISCAL,
  useEncerrarRegraFiscal,
  useMinhasRegrasFiscais,
  useOcultarRegraFiscal,
  usePerfisFiscais,
  useReexibirRegraFiscal,
  useRegrasGlobaisFiscais,
  useSalvarRegraFiscal,
} from "@/lib/fiscal-empresa-dados";

export const Route = createFileRoute("/_authenticated/fiscal-regras")({
  head: () => ({
    meta: [
      { title: "Regras fiscais por NCM — EZRA ERP" },
      {
        name: "description",
        content:
          "Veja as regras fiscais sugeridas por NCM, sobrescreva as que não servem para a sua empresa ou oculte-as.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RegrasFiscaisEmpresa,
});

const hojeIso = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

function RegrasFiscaisEmpresa() {
  const { data: sessao, isLoading } = useSessionData();
  // contador: a trava real é o banco (contador_edita_tributos); aqui só evita bloquear a tela.
  const gestao = (sessao?.roles ?? []).some(
    (r) => r === "administrador" || r === "gestor" || r === "contador",
  );
  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!gestao) {
    return (
      <EmptyState
        title="Só a administração mexe nas regras fiscais"
        description="Peça ao administrador ou ao gestor da empresa."
      />
    );
  }
  return <Painel tenantId={sessao?.profile?.tenant_id ?? undefined} />;
}

function Situacao({ status }: { status: RegraEmpresa["status"] }) {
  return (
    <Badge variant={status === "vigente" ? "default" : "secondary"}>
      {ROTULO_STATUS_REGRA[status]}
    </Badge>
  );
}

function Paginacao({
  pagina,
  total,
  onMudar,
}: {
  pagina: number;
  total: number;
  onMudar: (p: number) => void;
}) {
  const paginas = Math.max(1, Math.ceil(total / LIMITE_PAGINA_FISCAL));
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={pagina === 0}
        onClick={() => onMudar(pagina - 1)}
      >
        Anterior
      </Button>
      <span className="text-sm text-muted-foreground">
        Página {pagina + 1} de {paginas}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={pagina + 1 >= paginas}
        onClick={() => onMudar(pagina + 1)}
      >
        Próxima
      </Button>
    </div>
  );
}

function Painel({ tenantId }: { tenantId: string | undefined }) {
  const [aba, setAba] = useState("minhas");
  const [dialogo, setDialogo] = useState<{ versaoDe: RegraEmpresa | null } | null>(null);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [encerrar, setEncerrar] = useState<{ regra: RegraEmpresa; fim: string } | null>(null);
  const [ocultar, setOcultar] = useState<{ regra: RegraGlobalVista; motivo: string } | null>(null);
  const [erroOcultar, setErroOcultar] = useState<string | null>(null);

  const [minhas, setMinhas] = useState({
    busca: "",
    aplicada: "",
    apenasVigentes: true,
    pagina: 0,
  });
  const [base, setBase] = useState({ busca: "", aplicada: "", apenasVigentes: true, pagina: 0 });

  const perfis = usePerfisFiscais(tenantId);
  const listaMinhas = useMinhasRegrasFiscais(tenantId, {
    busca: minhas.aplicada,
    apenasVigentes: minhas.apenasVigentes,
    pagina: minhas.pagina,
  });
  const listaBase = useRegrasGlobaisFiscais(tenantId, {
    busca: base.aplicada,
    apenasVigentes: base.apenasVigentes,
    pagina: base.pagina,
  });

  const salvar = useSalvarRegraFiscal(tenantId);
  const encerrarMut = useEncerrarRegraFiscal(tenantId);
  const ocultarMut = useOcultarRegraFiscal(tenantId);
  const reexibirMut = useReexibirRegraFiscal(tenantId);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Regras fiscais por NCM"
        description="A base da Ze Tech sugere a tributação de cada NCM no cadastro de produtos. Aqui a sua empresa cria regras próprias, que passam na frente, ou oculta regras da base que não servem para ela."
      />
      <p className="max-w-3xl text-sm text-muted-foreground">
        São sugestões: nada muda sozinho nos seus produtos ou notas, e a validação final é do seu
        contador.
      </p>

      <Tabs value={aba} onValueChange={setAba}>
        <TabsList>
          <TabsTrigger value="minhas">Minhas regras</TabsTrigger>
          <TabsTrigger value="base">Regras da base</TabsTrigger>
        </TabsList>

        <TabsContent value="minhas" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                setMinhas((m) => ({ ...m, aplicada: m.busca.trim(), pagina: 0 }));
              }}
            >
              <div className="w-full max-w-xs space-y-1">
                <Label htmlFor="rf-busca-minhas">Buscar por NCM ou nome do perfil</Label>
                <Input
                  id="rf-busca-minhas"
                  value={minhas.busca}
                  onChange={(e) => setMinhas((m) => ({ ...m, busca: e.target.value }))}
                />
              </div>
              <Button type="submit" variant="outline">
                Buscar
              </Button>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={minhas.apenasVigentes}
                  onChange={(e) =>
                    setMinhas((m) => ({ ...m, apenasVigentes: e.target.checked, pagina: 0 }))
                  }
                />
                Só vigentes e futuras
              </label>
            </form>
            <Button
              onClick={() => {
                setErroSalvar(null);
                setDialogo({ versaoDe: null });
              }}
            >
              Nova regra
            </Button>
          </div>

          {listaMinhas.isPending ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : listaMinhas.isError ? (
            <div role="alert" className="text-destructive">
              {listaMinhas.error.message}
            </div>
          ) : listaMinhas.data.itens.length === 0 ? (
            <EmptyState
              title="Sua empresa ainda não tem regras próprias."
              description="Crie uma regra para mudar a tributação sugerida de um NCM só para a sua empresa."
            />
          ) : (
            <>
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
                    {listaMinhas.data.itens.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono">{r.ncmPrefixo}</TableCell>
                        <TableCell>{descreverCriterios(r)}</TableCell>
                        <TableCell>
                          {r.perfilNome}{" "}
                          <span className="text-xs text-muted-foreground">
                            ({r.perfilOrigem === "empresa" ? "da empresa" : "da base"})
                          </span>
                        </TableCell>
                        <TableCell>{resumoDoPerfil(r.perfil)}</TableCell>
                        <TableCell>
                          {dataBr(r.vigenciaInicio)} a{" "}
                          {r.vigenciaFim ? dataBr(r.vigenciaFim) : "sem fim"}
                        </TableCell>
                        <TableCell>{r.versao}</TableCell>
                        <TableCell>
                          <Situacao status={r.status} />
                        </TableCell>
                        <TableCell className="space-x-2 whitespace-nowrap">
                          {(r.status === "vigente" || r.status === "futura") && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setErroSalvar(null);
                                  setDialogo({ versaoDe: r });
                                }}
                              >
                                Nova versão
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setEncerrar({ regra: r, fim: r.vigenciaFim ?? hojeIso() })
                                }
                              >
                                Encerrar
                              </Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Paginacao
                pagina={minhas.pagina}
                total={listaMinhas.data.total}
                onMudar={(p) => setMinhas((m) => ({ ...m, pagina: p }))}
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="base" className="space-y-3">
          <p className="max-w-3xl text-sm text-muted-foreground">
            Ocultar vale só para a sua empresa e tem motivo registrado; a regra continua na base
            para as demais. Uma regra própria sempre passa na frente da regra da base.
          </p>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setBase((b) => ({ ...b, aplicada: b.busca.trim(), pagina: 0 }));
            }}
          >
            <div className="w-full max-w-xs space-y-1">
              <Label htmlFor="rf-busca-base">Buscar por NCM ou nome do perfil</Label>
              <Input
                id="rf-busca-base"
                value={base.busca}
                onChange={(e) => setBase((b) => ({ ...b, busca: e.target.value }))}
              />
            </div>
            <Button type="submit" variant="outline">
              Buscar
            </Button>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={base.apenasVigentes}
                onChange={(e) =>
                  setBase((b) => ({ ...b, apenasVigentes: e.target.checked, pagina: 0 }))
                }
              />
              Só vigentes e futuras
            </label>
          </form>

          {listaBase.isPending ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : listaBase.isError ? (
            <div role="alert" className="text-destructive">
              {listaBase.error.message}
            </div>
          ) : listaBase.data.itens.length === 0 ? (
            <EmptyState
              title="Nenhuma regra na base."
              description="A equipe Ze Tech ainda não publicou regras para esta busca."
            />
          ) : (
            <>
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
                      <TableHead>Na sua empresa</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listaBase.data.itens.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono">{r.ncmPrefixo}</TableCell>
                        <TableCell>{descreverCriterios(r)}</TableCell>
                        <TableCell>{r.perfilNome}</TableCell>
                        <TableCell>{resumoDoPerfil(r.perfil)}</TableCell>
                        <TableCell>
                          {dataBr(r.vigenciaInicio)} a{" "}
                          {r.vigenciaFim ? dataBr(r.vigenciaFim) : "sem fim"}
                        </TableCell>
                        <TableCell>{r.versao}</TableCell>
                        <TableCell>
                          {r.oculta ? (
                            <span className="space-y-1">
                              <Badge variant="destructive">Oculta</Badge>
                              {r.motivoOculta && (
                                <span className="block text-xs text-muted-foreground">
                                  {r.motivoOculta}
                                </span>
                              )}
                            </span>
                          ) : (
                            <Situacao status={r.status} />
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {r.oculta ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={reexibirMut.isPending}
                              onClick={() =>
                                reexibirMut.mutate(r.id, {
                                  onSuccess: () =>
                                    toast.success("Regra voltou a valer para a sua empresa"),
                                  onError: (e: Error) => toast.error(e.message),
                                })
                              }
                            >
                              Voltar a usar
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setErroOcultar(null);
                                setOcultar({ regra: r, motivo: "" });
                              }}
                            >
                              Ocultar
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Paginacao
                pagina={base.pagina}
                total={listaBase.data.total}
                onMudar={(p) => setBase((b) => ({ ...b, pagina: p }))}
              />
            </>
          )}
        </TabsContent>
      </Tabs>

      {dialogo && (
        <RegraFiscalDialog
          key={dialogo.versaoDe?.id ?? "nova"}
          aberto
          versaoDe={dialogo.versaoDe}
          hoje={hojeIso()}
          perfis={perfis.data ?? []}
          salvando={salvar.isPending}
          erroDoBanco={erroSalvar}
          onFechar={() => setDialogo(null)}
          onSalvar={(dados) => {
            setErroSalvar(null);
            salvar.mutate(dados, {
              onSuccess: (r) => {
                toast.success(
                  r.acao === "igual"
                    ? "Nada mudou: a regra já estava assim."
                    : r.acao === "nova_versao"
                      ? `Nova versão ${r.versao} criada.`
                      : "Regra criada.",
                );
                setDialogo(null);
              },
              onError: (e: Error) => setErroSalvar(e.message),
            });
          }}
        />
      )}

      <AlertDialog
        open={encerrar !== null}
        onOpenChange={(a) => !a && !encerrarMut.isPending && setEncerrar(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar regra</AlertDialogTitle>
            <AlertDialogDescription>
              {encerrar
                ? `NCM ${encerrar.regra.ncmPrefixo}, perfil ${encerrar.regra.perfilNome}, versão ${encerrar.regra.versao}. A regra vale até o último dia informado e continua no histórico; depois dele volta a valer a regra da base. Só é possível antecipar o fim.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {encerrar && (
            <div className="space-y-1">
              <Label htmlFor="rf-fim-enc">Último dia de vigência</Label>
              <Input
                id="rf-fim-enc"
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
                if (!encerrar) return;
                encerrarMut.mutate(
                  { regraId: encerrar.regra.id, fim: encerrar.fim },
                  {
                    onSuccess: () => {
                      toast.success("Regra encerrada");
                      setEncerrar(null);
                    },
                    onError: (er: Error) => toast.error(er.message),
                  },
                );
              }}
            >
              {encerrarMut.isPending ? "Encerrando…" : "Encerrar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={ocultar !== null}
        onOpenChange={(a) => !a && !ocultarMut.isPending && setOcultar(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ocultar regra da base</AlertDialogTitle>
            <AlertDialogDescription>
              {ocultar
                ? `NCM ${ocultar.regra.ncmPrefixo}, perfil ${ocultar.regra.perfilNome}. A sua empresa deixa de receber esta regra como sugestão; as demais empresas continuam recebendo. Você pode voltar a usar quando quiser.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {ocultar && (
            <div className="space-y-1">
              <Label htmlFor="rf-motivo">Motivo</Label>
              <Input
                id="rf-motivo"
                value={ocultar.motivo}
                maxLength={300}
                onChange={(e) => setOcultar({ ...ocultar, motivo: e.target.value })}
              />
              {erroOcultar && (
                <p role="alert" className="text-sm text-destructive">
                  {erroOcultar}
                </p>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={ocultarMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={ocultarMut.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (!ocultar) return;
                const v = validarMotivo(ocultar.motivo);
                if (v.motivo === null) {
                  setErroOcultar(v.erro);
                  return;
                }
                ocultarMut.mutate(
                  { regraId: ocultar.regra.id, motivo: v.motivo },
                  {
                    onSuccess: () => {
                      toast.success("Regra oculta para a sua empresa");
                      setOcultar(null);
                    },
                    onError: (er: Error) => setErroOcultar(er.message),
                  },
                );
              }}
            >
              {ocultarMut.isPending ? "Ocultando…" : "Ocultar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
