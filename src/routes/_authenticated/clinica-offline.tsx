import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Lock, LockOpen, RefreshCw, Trash2, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";

import { AtendimentosVisita } from "@/components/app/AtendimentosVisita";
import { ExamesVisita } from "@/components/app/ExamesVisita";
import { TrocarLoteDialog, VacinasVisita } from "@/components/app/VacinasVisita";
import { CadastroRapido } from "@/components/app/CadastroRapido";
import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import {
  decidirAcesso,
  lerAcessoLocal,
  limparAcessoLocal,
  salvarAcessoLocal,
} from "@/lib/acesso-clinica";
import { useModulosCnae } from "@/lib/cnae";
import { erroDaSenha, SENHA_MINIMA, type Cofre } from "@/lib/cofre";
import {
  MINUTOS_PARA_TRAVAR,
  apagarCofre,
  criarCofre,
  destravarCofre,
  travarCofre,
  useCofre,
} from "@/lib/cofre-sessao";
import {
  CHAVE_DOSES,
  TIPO_VACINA_APLICAR,
  dosesDaCopia,
  somarDose,
  type DosesAplicadas,
} from "@/lib/vacina-offline";
import { enviarOperacao } from "@/lib/fila-executores";
import {
  ordenar,
  reabrir,
  resumoDaFila,
  situacaoNaFila,
  sincronizar,
  type MudancaFila,
  type OperacaoFila,
} from "@/lib/fila-clinica";
import { dateTimeBR } from "@/lib/format";
import { ehErroDeRede, useOnline } from "@/lib/offline";
import {
  VALIDADE_COPIA_DIAS,
  copiaVencida,
  resumoDaCopia,
  validadeDaCopia,
  type CopiaVisita,
} from "@/lib/visita";

export const Route = createFileRoute("/_authenticated/clinica-offline")({
  head: () => ({
    meta: [
      { title: "Trabalho sem internet — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Cofre criptografado do notebook, cópia da visita e pendências de envio da clínica.",
      },
    ],
  }),
  component: OfflineModulo,
});

function OfflineModulo() {
  const { data: sessao, isLoading } = useSessionData();
  const modulos = useModulosCnae();
  // sem sinal e com o cache de 24 horas vencido, a sessão guardada neste notebook diz quem é a pessoa
  const [idLocal, setIdLocal] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setIdLocal(data.session?.user.id ?? null));
  }, []);
  const userId = sessao?.user?.id ?? idLocal ?? null;
  const veterinario = (sessao?.roles ?? []).includes("veterinario");
  const sessaoConfirmada = !!sessao?.user;

  // com a sessão conhecida, guarda (ou apaga) os dois sins e nãos que valem por 7 dias, como a cópia da visita
  useEffect(() => {
    if (!sessaoConfirmada || !userId) return;
    if (modulos.clinica && veterinario)
      salvarAcessoLocal(userId, { clinica: true, veterinario: true });
    else limparAcessoLocal();
  }, [sessaoConfirmada, userId, modulos.clinica, veterinario]);

  const decisao = decidirAcesso({
    carregando: isLoading || idLocal === undefined,
    sessaoConfirmada,
    clinica: modulos.clinica,
    veterinario,
    local: userId ? lerAcessoLocal(userId) : null,
  });
  if (decisao === "carregando") return <div className="panel h-40 animate-pulse" />;
  if (decisao === "sem_clinica") return <ModuloBloqueado modulo="clinica" />;
  if (decisao === "sem_perfil")
    return (
      <EmptyState
        title="Só o veterinário usa o trabalho sem internet"
        description="Entre com uma conta de veterinário para abrir o cofre deste notebook."
      />
    );
  if (decisao === "sem_confirmacao")
    return (
      <EmptyState
        title="Entre com internet uma vez"
        description="Para usar o trabalho sem internet, entre no sistema com internet ao menos uma vez neste notebook, com a conta do veterinário."
      />
    );
  return <Offline />;
}

function Offline() {
  const { estado, cofre } = useCofre();
  const online = useOnline();
  return (
    <div>
      <PageHeader
        title="Trabalho sem internet"
        description="O que a clínica grava sem sinal fica guardado, criptografado, neste notebook e é enviado quando a internet volta. Só o veterinário usa esta tela."
        actions={
          <Badge variant={online ? "default" : "outline"} className="gap-1">
            {online ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
            {online ? "Com internet" : "Sem internet"}
          </Badge>
        }
      />
      {estado === "carregando" ? (
        <div className="panel h-40 animate-pulse" />
      ) : estado === "sem_cofre" ? (
        <CriarCofre />
      ) : estado === "travado" ? (
        <DestravarCofre />
      ) : (
        <CofreAberto cofre={cofre} online={online} />
      )}
    </div>
  );
}

function CriarCofre() {
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [trabalhando, setTrabalhando] = useState(false);
  const erro = erroDaSenha(senha, confirmacao);

  async function criar() {
    setTrabalhando(true);
    try {
      await criarCofre(senha);
      toast.success("Cofre criado");
    } catch (e) {
      toast.error("Não foi possível criar o cofre", { description: (e as Error).message });
    } finally {
      setTrabalhando(false);
    }
  }

  return (
    <div className="panel grid max-w-lg gap-3 p-4">
      <h2 className="font-display text-lg font-semibold">Criar o cofre deste notebook</h2>
      <p className="text-sm text-muted-foreground">
        Escolha uma senha. Tudo o que a clínica guardar aqui (cópia da visita e gravações sem
        internet) só abre com ela, e o cofre trava sozinho depois de {MINUTOS_PARA_TRAVAR} minutos
        parado.
      </p>
      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <strong>Anote a senha.</strong> Ela não é guardada em lugar nenhum: se for esquecida, o que
        estiver no notebook não se recupera. Por isso, envie as pendências assim que houver
        internet.
      </div>
      <div>
        <Label htmlFor="cf-senha">Senha (mínimo {SENHA_MINIMA} caracteres)</Label>
        <Input
          id="cf-senha"
          type="password"
          autoComplete="new-password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="cf-conf">Repita a senha</Label>
        <Input
          id="cf-conf"
          type="password"
          autoComplete="new-password"
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
        />
      </div>
      {senha && erro && <p className="text-sm text-destructive">{erro}</p>}
      <div>
        <Button onClick={() => void criar()} disabled={trabalhando || !!erro}>
          <Lock className="size-4" /> {trabalhando ? "Criando…" : "Criar cofre"}
        </Button>
      </div>
    </div>
  );
}

function DestravarCofre() {
  const [senha, setSenha] = useState("");
  const [trabalhando, setTrabalhando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [esqueci, setEsqueci] = useState(false);

  async function destravar() {
    setTrabalhando(true);
    setErro(null);
    try {
      if (!(await destravarCofre(senha))) setErro("Senha incorreta");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setTrabalhando(false);
    }
  }

  return (
    <form
      className="panel grid max-w-lg gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void destravar();
      }}
    >
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <Lock className="size-5" /> Cofre travado
      </h2>
      <p className="text-sm text-muted-foreground">
        Digite a senha para ver as pendências e a cópia da visita.
      </p>
      <div>
        <Label htmlFor="cf-abrir">Senha</Label>
        <Input
          id="cf-abrir"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
        />
      </div>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={trabalhando || !senha}>
          <LockOpen className="size-4" /> {trabalhando ? "Abrindo…" : "Destravar"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEsqueci(true)}>
          Esqueci a senha
        </Button>
      </div>
      <Dialog open={esqueci} onOpenChange={(o) => !o && setEsqueci(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Esqueci a senha do cofre</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 text-sm">
            <p>
              A senha não se recupera. Para voltar a usar o trabalho sem internet é preciso{" "}
              <strong>apagar o cofre</strong> deste notebook e criar um novo.
            </p>
            <p className="font-medium text-destructive">
              Tudo o que estiver guardado nele (cópia da visita e gravações ainda não enviadas) será
              perdido, sem volta.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEsqueci(false)}>
              Voltar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setEsqueci(false);
                void apagarCofre().then(() => toast.success("Cofre apagado: crie um novo"));
              }}
            >
              Apagar o cofre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}

const rotuloSituacao = {
  pronta: "Pronta para enviar",
  aguardando: "Aguardando outra operação",
  bloqueada: "Bloqueada por uma operação recusada",
  recusada: "Recusada pelo banco",
} as const;

function CofreAberto({ cofre, online }: { cofre: Cofre; online: boolean }) {
  const [fila, setFila] = useState<OperacaoFila[]>([]);
  const [ilegiveis, setIlegiveis] = useState<string[]>([]);
  const [copia, setCopia] = useState<CopiaVisita | null>(null);
  const [copiaApagada, setCopiaApagada] = useState(false);
  const [aplicadas, setAplicadas] = useState<Record<string, number>>({});
  const [carregando, setCarregando] = useState(true);
  const [dias, setDias] = useState("1");
  const [preparando, setPreparando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [descartando, setDescartando] = useState<OperacaoFila | null>(null);
  const [apagandoTudo, setApagandoTudo] = useState(false);
  const [trocandoLote, setTrocandoLote] = useState<OperacaoFila | null>(null);
  const enviandoRef = useRef(false);

  const recarregar = useCallback(async () => {
    try {
      const { itens, ilegiveis: ruins } = await cofre.listar<OperacaoFila>("fila");
      setFila(ordenar(itens.map(([, op]) => op)));
      setIlegiveis(ruins);
      let c = (await cofre.ler<CopiaVisita>("copia", "atual")) ?? null;
      // a cópia de consulta vence e some; a fila de pendências nunca some sozinha
      if (c && copiaVencida(c)) {
        await cofre.apagar("copia", "atual");
        c = null;
        setCopiaApagada(true);
      }
      setCopia(c);
      const doses = (await cofre.ler<DosesAplicadas>("copia", CHAVE_DOSES)) ?? null;
      setAplicadas(c ? dosesDaCopia(doses, c.geradaEm) : {});
    } catch (e) {
      toast.error("Não foi possível ler o cofre", { description: (e as Error).message });
    } finally {
      setCarregando(false);
    }
  }, [cofre]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const enviarPendencias = useCallback(
    async (avisar: boolean) => {
      if (enviandoRef.current) return;
      enviandoRef.current = true;
      setEnviando(true);
      try {
        const { itens } = await cofre.listar<OperacaoFila>("fila");
        const copiaAtual = await cofre.ler<CopiaVisita>("copia", "atual");
        let doses = (await cofre.ler<DosesAplicadas>("copia", CHAVE_DOSES)) ?? null;
        const r = await sincronizar(
          itens.map(([, op]) => op),
          enviarOperacao,
          {
            ehErroDeRede,
            aoMudar: async (m: MudancaFila) => {
              if (m.tipo === "remover") {
                // a dose enviada sai da conta da fila, mas a cópia ainda traz o saldo antigo: guarda a dose antes de tirar da fila
                const op = itens.find(([, o]) => o.id === m.id)?.[1];
                const lote = (op?.payload as { estoque_lote_id?: string } | null)?.estoque_lote_id;
                if (copiaAtual && op?.tipo === TIPO_VACINA_APLICAR && lote) {
                  doses = somarDose(doses, copiaAtual.geradaEm, lote);
                  await cofre.gravar("copia", CHAVE_DOSES, doses);
                }
                await cofre.apagar("fila", m.id);
              } else await cofre.gravar("fila", m.op.id, m.op);
            },
          },
        );
        await recarregar();
        if (r.interrompida) toast.warning("A internet caiu: o resto continua guardado");
        else if (r.recusadas > 0)
          toast.error(`${r.recusadas} operação(ões) recusada(s)`, {
            description: "Veja o motivo na lista e resolva antes de tentar de novo.",
          });
        else if (r.enviadas > 0) toast.success(`${r.enviadas} operação(ões) enviada(s)`);
        else if (avisar) toast.message("Nada para enviar");
      } catch (e) {
        toast.error("Não foi possível enviar", { description: (e as Error).message });
      } finally {
        enviandoRef.current = false;
        setEnviando(false);
      }
    },
    [cofre, recarregar],
  );

  // a internet voltou com coisa pronta para enviar: envia sem a pessoa precisar lembrar
  const prontas = resumoDaFila(fila).prontas;
  useEffect(() => {
    if (online && prontas > 0 && !carregando) void enviarPendencias(false);
  }, [online, prontas, carregando, enviarPendencias]);

  async function prepararVisita() {
    setPreparando(true);
    try {
      const { data, error } = await supabase.rpc("clinica_visita_preparar", {
        p_dias: Number(dias),
      });
      if (error) throw error;
      const dados = data as unknown as CopiaVisita["dados"] & { gerada_em: string };
      const geradaEm = new Date(dados.gerada_em);
      const nova: CopiaVisita = {
        geradaEm: geradaEm.toISOString(),
        validaAte: validadeDaCopia(geradaEm),
        dados,
      };
      await cofre.gravar("copia", "atual", nova);
      setCopiaApagada(false);
      setCopia(nova);
      toast.success("Visita preparada: a cópia está no cofre");
    } catch (e) {
      toast.error("Não foi possível preparar a visita", { description: (e as Error).message });
    } finally {
      setPreparando(false);
    }
  }

  async function tentarDeNovo(op: OperacaoFila) {
    const nova = reabrir(fila, op.id).find((x) => x.id === op.id);
    if (nova) await cofre.gravar("fila", nova.id, nova);
    await recarregar();
    if (online) void enviarPendencias(false);
  }

  async function descartar() {
    if (!descartando) return;
    await cofre.apagar("fila", descartando.id);
    setDescartando(null);
    await recarregar();
    toast.success("Operação descartada");
  }

  async function copiarDados(op: OperacaoFila) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(op, null, 2));
      toast.success("Dados copiados");
    } catch {
      toast.error("Não foi possível copiar: selecione e copie o texto");
    }
  }

  const resumo = resumoDaFila(fila);
  const r = copia ? resumoDaCopia(copia) : null;

  return (
    <div className="grid gap-4">
      <div className="panel flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
        <span className="flex items-center gap-2">
          <LockOpen className="size-4" /> Cofre aberto — trava sozinho depois de{" "}
          {MINUTOS_PARA_TRAVAR} minutos parado.
        </span>
        <Button variant="outline" size="sm" onClick={() => travarCofre()}>
          <Lock className="size-4" /> Travar agora
        </Button>
      </div>

      <div className="panel grid gap-3 p-4">
        <h2 className="font-display text-lg font-semibold">Preparar visita</h2>
        <p className="text-sm text-muted-foreground">
          Antes de sair, com internet, baixe para o cofre a sua agenda, os pacientes e tutores dela,
          o catálogo de vacinas com os lotes que têm saldo e os modelos de exame. A cópia vale{" "}
          {VALIDADE_COPIA_DIAS} dias e some depois; cada paciente baixado fica registrado na
          auditoria de acessos.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44">
            <Label htmlFor="of-dias">Agenda dos próximos</Label>
            <Select value={dias} onValueChange={setDias}>
              <SelectTrigger id="of-dias">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["1", "2", "3", "5", "7"].map((d) => (
                  <SelectItem key={d} value={d}>
                    {d === "1" ? "Hoje" : `${d} dias`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => void prepararVisita()} disabled={preparando || !online}>
            <RefreshCw className="size-4" /> {preparando ? "Baixando…" : "Preparar visita"}
          </Button>
          {!online && (
            <span className="text-xs text-muted-foreground">Precisa de internet para baixar.</span>
          )}
        </div>
        {copiaApagada && (
          <p className="text-sm text-amber-800">
            A cópia anterior venceu e foi apagada: prepare a visita de novo antes de sair.
          </p>
        )}
        {copia && r ? (
          <div className="rounded-md border p-3 text-sm">
            <p className="font-medium">Cópia de {dateTimeBR(copia.geradaEm)}</p>
            <p className="text-muted-foreground">
              Vale até {dateTimeBR(copia.validaAte)} · Dr(a). {copia.dados.veterinario.nome} (CRMV{" "}
              {copia.dados.veterinario.crmv}-{copia.dados.veterinario.crmv_uf}) · agenda de{" "}
              {copia.dados.de} a {copia.dados.ate}
            </p>
            <p className="mt-1">
              {r.consultas} consulta(s) · {r.vacinas} item(ns) do catálogo de vacinas com {r.lotes}{" "}
              lote(s) · {r.modelos} modelo(s) de exame
            </p>
          </div>
        ) : (
          !copiaApagada && <p className="text-sm text-muted-foreground">Nenhuma cópia no cofre.</p>
        )}
      </div>

      <CadastroRapido cofre={cofre} copia={copia} online={online} aoGuardar={recarregar} />

      <AtendimentosVisita
        cofre={cofre}
        copia={copia}
        fila={fila}
        online={online}
        aoGuardar={recarregar}
      />

      <VacinasVisita
        cofre={cofre}
        copia={copia}
        fila={fila}
        online={online}
        aplicadas={aplicadas}
        aoGuardar={recarregar}
      />

      <ExamesVisita
        cofre={cofre}
        copia={copia}
        fila={fila}
        online={online}
        aoGuardar={recarregar}
      />

      <div className="panel grid gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">Pendências de envio</h2>
          <Button
            onClick={() => void enviarPendencias(true)}
            disabled={enviando || !online || resumo.prontas === 0}
          >
            <RefreshCw className="size-4" /> {enviando ? "Enviando…" : "Enviar agora"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Gravações feitas sem internet esperam aqui e saem em ordem quando há sinal. O que o banco
          recusar fica guardado com o motivo e nunca é descartado sozinho.
        </p>
        {carregando ? (
          <div className="h-12 animate-pulse rounded-md bg-muted" />
        ) : fila.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada pendente.</p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {fila.map((op) => {
              const s = situacaoNaFila(op, fila);
              return (
                <li key={op.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{op.descricao}</p>
                      <p className="text-xs text-muted-foreground">
                        Feita em {dateTimeBR(op.criadaEm)}
                        {op.tentativas > 0 ? ` · ${op.tentativas} tentativa(s)` : ""}
                      </p>
                    </div>
                    <Badge variant={s === "recusada" ? "destructive" : "outline"}>
                      {rotuloSituacao[s]}
                    </Badge>
                  </div>
                  {op.erro && <p className="mt-1 text-xs text-destructive">Motivo: {op.erro}</p>}
                  {op.estado === "recusada" && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => void tentarDeNovo(op)}>
                        Tentar de novo
                      </Button>
                      {op.tipo === TIPO_VACINA_APLICAR && (
                        <Button variant="outline" size="sm" onClick={() => setTrocandoLote(op)}>
                          Trocar o lote…
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => void copiarDados(op)}>
                        Copiar dados
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDescartando(op)}>
                        Descartar…
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {ilegiveis.length > 0 && (
          <p className="rounded-md border border-destructive p-3 text-sm text-destructive">
            {ilegiveis.length} registro(s) do cofre não abriram (adulterados ou de outra senha).
            Eles não foram apagados; procure o suporte antes de apagar o cofre.
          </p>
        )}
      </div>

      <div>
        <Button variant="ghost" size="sm" onClick={() => setApagandoTudo(true)}>
          <Trash2 className="size-4" /> Apagar o cofre deste notebook
        </Button>
      </div>

      {trocandoLote && (
        <TrocarLoteDialog
          operacao={trocandoLote}
          copia={copia}
          fila={fila}
          aplicadas={aplicadas}
          aoFechar={() => setTrocandoLote(null)}
          aoTrocar={async (nova) => {
            await cofre.gravar("fila", nova.id, nova);
            setTrocandoLote(null);
            await recarregar();
            if (online) void enviarPendencias(false);
          }}
        />
      )}

      <Dialog open={!!descartando} onOpenChange={(o) => !o && setDescartando(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Descartar operação recusada</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 text-sm">
            <p>
              <strong>{descartando?.descricao}</strong> foi recusada: {descartando?.erro}
            </p>
            <p className="text-amber-800">
              Descartar apaga estes dados do notebook e não tem volta. Copie os dados antes se
              precisar refazer o registro.
            </p>
            <Textarea
              readOnly
              rows={6}
              value={descartando ? JSON.stringify(descartando.payload, null, 2) : ""}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDescartando(null)}>
              Voltar
            </Button>
            <Button variant="destructive" onClick={() => void descartar()}>
              Descartar mesmo assim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={apagandoTudo} onOpenChange={(o) => !o && setApagandoTudo(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Apagar o cofre</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 text-sm">
            {fila.length > 0 || ilegiveis.length > 0 ? (
              <p className="font-medium text-destructive">
                Há {fila.length + ilegiveis.length} registro(s) que ainda não foram enviados: eles
                serão perdidos.
              </p>
            ) : (
              <p>Nada pendente. A cópia da visita e a senha serão apagadas deste notebook.</p>
            )}
            <p className="text-muted-foreground">Depois será preciso criar o cofre de novo.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApagandoTudo(false)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void apagarCofre().then(() => toast.success("Cofre apagado"));
              }}
            >
              Apagar tudo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
