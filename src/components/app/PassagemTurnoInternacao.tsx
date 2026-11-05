import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, History, Plus, X } from "lucide-react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { dateTimeBR } from "@/lib/format";
import type { PrescricaoInternacao } from "@/lib/internacao";
import {
  LIMITE_PENDENCIAS,
  LIMITE_RESUMO,
  LIMITE_TEXTO_PENDENCIA,
  aguardaMeuCiente,
  dosesProximas,
  limparPendencias,
  rotuloPendencia,
  validarPassagem,
  type HistoricoTurnos,
  type PendenciaAberta,
  type TurnoInternacao,
} from "@/lib/passagem-turno";
import { agruparSeries, formatarValor, novaChaveEnvio } from "@/lib/sinais-vitais";
import { chaveSinais, historicoSinais } from "@/lib/sinais-vitais-consulta";

type Props = {
  internacaoId: string;
  aberta: boolean;
  prescricoes: PrescricaoInternacao[];
};

const chaveTurnos = (id: string) => ["clinica-turnos", id] as const;

/**
 * Passagem de turno da internação: o que o próximo profissional precisa ver (última passagem, pendências abertas,
 * últimas medidas e doses pendentes) e onde escreve a sua. Ciente não resolve pendência; dose só aparece para consulta.
 */
export function PassagemTurnoInternacao({ internacaoId, aberta, prescricoes }: Props) {
  const qc = useQueryClient();
  const [baixando, setBaixando] = useState<{
    p: PendenciaAberta;
    modo: "resolvida" | "descartada";
  } | null>(null);

  const turnos = useQuery({
    queryKey: chaveTurnos(internacaoId),
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_turnos_internacao", {
        p_internacao_id: internacaoId,
      });
      if (error) throw error;
      return data as unknown as HistoricoTurnos;
    },
  });
  // mesma consulta e mesma chave da seção de sinais vitais: não duplica a chamada
  const sinais = useQuery({
    queryKey: chaveSinais(internacaoId),
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: () => historicoSinais(internacaoId),
  });

  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: chaveTurnos(internacaoId) });
    void qc.invalidateQueries({ queryKey: ["clinica-plantao"] });
  };

  const ciente = useMutation({
    mutationFn: async (turnoId: string) => {
      const { error } = await supabase.rpc("clinica_turno_ciente", { p_turno_id: turnoId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ciente registrado");
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dados = turnos.data;
  const [ultimo, ...anteriores] = dados?.turnos ?? [];
  const abertas = dados?.pendencias_abertas ?? [];
  const medidas = sinais.data ? agruparSeries(sinais.data.registros).filter((s) => s.ultimo) : [];
  const doses = dosesProximas(prescricoes);

  return (
    <section aria-labelledby={`pt-${internacaoId}`} className="space-y-3">
      <h4 id={`pt-${internacaoId}`} className="text-sm font-semibold">
        Passagem de turno
      </h4>

      {turnos.isLoading ? (
        <div className="panel h-20 animate-pulse" />
      ) : turnos.isError ? (
        <p className="text-sm text-destructive">
          Não foi possível carregar a passagem de turno: {(turnos.error as Error).message}
        </p>
      ) : (
        <>
          <div className="rounded-md border border-border p-3">
            <h5 className="text-sm font-medium">Última passagem</h5>
            {ultimo ? (
              <div className="mt-1 space-y-2">
                <p className="whitespace-pre-wrap break-words text-sm">{ultimo.resumo}</p>
                <p className="text-xs text-muted-foreground">
                  {ultimo.autor.nome} · {dateTimeBR(ultimo.created_at)}
                </p>
                {ultimo.ciencias.length > 0 && (
                  <ul className="text-xs text-muted-foreground" aria-label="Ciências da passagem">
                    {ultimo.ciencias.map((c) => (
                      <li key={`${c.profissional}-${c.created_at}`}>
                        <Check className="mr-1 inline size-3" />
                        Ciente: {c.profissional} · {dateTimeBR(c.created_at)}
                      </li>
                    ))}
                  </ul>
                )}
                {aguardaMeuCiente(ultimo, aberta) && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">Aguarda o seu ciente</Badge>
                    <Button
                      size="sm"
                      disabled={ciente.isPending}
                      onClick={() => ciente.mutate(ultimo.id)}
                    >
                      Dar ciente
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Ciente registra que você leu; não resolve pendência nem executa dose.
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                Nenhuma passagem de turno escrita para esta internação.
              </p>
            )}
          </div>

          <div className="rounded-md border border-border p-3">
            <h5 className="text-sm font-medium">
              Pendências abertas{" "}
              {abertas.length > 0 && (
                <span className="text-muted-foreground">({abertas.length})</span>
              )}
            </h5>
            {abertas.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">Nenhuma pendência aberta.</p>
            ) : (
              <ul className="mt-1 divide-y divide-border text-sm" aria-label="Pendências abertas">
                {abertas.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-start justify-between gap-2 py-1.5"
                  >
                    <div className="min-w-0">
                      <p className="break-words">{p.texto}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.autor} · {dateTimeBR(p.created_at)}
                      </p>
                    </div>
                    {aberta && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setBaixando({ p, modo: "resolvida" })}
                        >
                          Resolver
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setBaixando({ p, modo: "descartada" })}
                        >
                          Descartar
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-border p-3">
              <h5 className="text-sm font-medium">Últimas medidas</h5>
              {sinais.isLoading ? (
                <p className="mt-1 text-sm text-muted-foreground">Carregando as medidas…</p>
              ) : sinais.isError ? (
                <p className="mt-1 text-sm text-destructive" role="alert">
                  Não foi possível carregar as medidas. Isso não significa que não haja medidas
                  registradas.
                </p>
              ) : medidas.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">Nenhuma medida registrada.</p>
              ) : (
                <ul className="mt-1 text-sm" aria-label="Últimas medidas">
                  {medidas.map((s) => (
                    <li key={s.chave}>
                      {s.nome}: <strong>{formatarValor(s.ultimo!.valor, s.unidade)}</strong>{" "}
                      <span className="text-xs text-muted-foreground">
                        {dateTimeBR(s.ultimo!.medido_em)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-md border border-border p-3">
              <h5 className="text-sm font-medium">Doses pendentes (próximas 12 h)</h5>
              {doses.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Nenhuma dose pendente nesse período.
                </p>
              ) : (
                <ul className="mt-1 text-sm" aria-label="Doses pendentes">
                  {doses.map((d) => (
                    <li key={d.id} className={d.atraso_min > 0 ? "text-destructive" : ""}>
                      {dateTimeBR(d.previsto_em)} · {d.medicamento} {d.dose}
                      {d.via ? ` (${d.via})` : ""}
                      {d.atraso_min > 0 ? " · atrasada" : ""}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                Só consulta. Registre a execução no Mapa de execuções: a passagem não marca dose.
              </p>
            </div>
          </div>

          {aberta && <FormularioPassagem internacaoId={internacaoId} aoSalvar={recarregar} />}

          {anteriores.length > 0 && <Anteriores turnos={anteriores} />}
        </>
      )}

      {baixando && (
        <BaixarDialog
          pendencia={baixando.p}
          modo={baixando.modo}
          aoFechar={() => setBaixando(null)}
          aoSalvar={() => {
            setBaixando(null);
            recarregar();
          }}
        />
      )}
    </section>
  );
}

function FormularioPassagem({
  internacaoId,
  aoSalvar,
}: {
  internacaoId: string;
  aoSalvar: () => void;
}) {
  const id = useId();
  const [resumo, setResumo] = useState("");
  const [pendencias, setPendencias] = useState<string[]>([]);
  const [chave, setChave] = useState(() => novaChaveEnvio());
  const limpas = limparPendencias(pendencias);
  const erroBruto = validarPassagem({ resumo, pendencias });
  // sem nada digitado o botão fica desabilitado sem mostrar aviso
  const erro = resumo.trim() === "" && limpas.length === 0 ? null : erroBruto;

  const registrar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("clinica_turno_registrar", {
        p_internacao_id: internacaoId,
        p_dados: { resumo: resumo.trim(), pendencias: limpas, chave },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Passagem registrada");
      setResumo("");
      setPendencias([]);
      setChave(novaChaveEnvio());
      aoSalvar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-md border border-border p-3">
      <Label htmlFor={`${id}-resumo`} className="text-sm font-medium">
        Escrever a passagem
      </Label>
      <Textarea
        id={`${id}-resumo`}
        rows={3}
        className="mt-1"
        maxLength={LIMITE_RESUMO}
        placeholder="Como o animal está, o que mudou, o que o próximo turno precisa saber."
        disabled={registrar.isPending}
        value={resumo}
        onChange={(e) => setResumo(e.target.value)}
      />
      <div className="mt-2 space-y-2">
        <Label className="block text-sm">Pendências para o próximo turno (opcional)</Label>
        {pendencias.map((t, i) => (
          <div key={i} className="flex gap-2">
            <Input
              aria-label={`Pendência ${i + 1}`}
              maxLength={LIMITE_TEXTO_PENDENCIA}
              disabled={registrar.isPending}
              value={t}
              onChange={(e) =>
                setPendencias(pendencias.map((x, k) => (k === i ? e.target.value : x)))
              }
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Remover pendência ${i + 1}`}
              disabled={registrar.isPending}
              onClick={() => setPendencias(pendencias.filter((_, k) => k !== i))}
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}
        {pendencias.length < LIMITE_PENDENCIAS && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={registrar.isPending}
            onClick={() => setPendencias([...pendencias, ""])}
          >
            <Plus className="size-4" /> Adicionar pendência
          </Button>
        )}
      </div>
      {erro && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {erro}
        </p>
      )}
      <Button
        className="mt-3"
        size="sm"
        disabled={registrar.isPending || !!erroBruto}
        onClick={() => registrar.mutate()}
      >
        {registrar.isPending ? "Registrando…" : "Registrar passagem"}
      </Button>
    </div>
  );
}

function Anteriores({ turnos }: { turnos: TurnoInternacao[] }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground underline"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
      >
        <History className="size-3" /> {aberto ? "Ocultar" : "Ver"} passagens anteriores (
        {turnos.length})
      </button>
      {aberto && (
        <ol className="mt-2 space-y-2">
          {turnos.map((t) => (
            <li key={t.id} className="rounded-md border border-border p-2 text-sm">
              <p className="whitespace-pre-wrap break-words">{t.resumo}</p>
              <p className="text-xs text-muted-foreground">
                {t.autor.nome} · {dateTimeBR(t.created_at)}
                {t.ciencias.length > 0 &&
                  ` · ciente: ${t.ciencias.map((c) => `${c.profissional} (${dateTimeBR(c.created_at)})`).join(", ")}`}
              </p>
              {t.pendencias.length > 0 && (
                <ul className="mt-1 text-xs">
                  {t.pendencias.map((p) => (
                    <li key={p.id}>
                      <span className="font-medium">{rotuloPendencia(p)}</span>: {p.texto}
                      {p.baixa && (
                        <span className="text-muted-foreground">
                          {" "}
                          — {p.baixa.profissional}, {dateTimeBR(p.baixa.created_at)}
                          {p.baixa.observacao ? `: ${p.baixa.observacao}` : ""}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function BaixarDialog({
  pendencia,
  modo,
  aoFechar,
  aoSalvar,
}: {
  pendencia: PendenciaAberta;
  modo: "resolvida" | "descartada";
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [observacao, setObservacao] = useState("");
  const obrigatoria = modo === "descartada";
  const curta = observacao.trim().length > 0 && observacao.trim().length < 3;
  const falta = obrigatoria && observacao.trim().length < 3;

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("clinica_pendencia_baixar", {
        p_id: pendencia.id,
        p_dados: {
          situacao: modo,
          ...(observacao.trim() ? { observacao: observacao.trim() } : {}),
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(modo === "resolvida" ? "Pendência resolvida" : "Pendência descartada");
      aoSalvar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {modo === "resolvida" ? "Resolver pendência" : "Descartar pendência"}
          </DialogTitle>
        </DialogHeader>
        <p className="break-words text-sm">{pendencia.texto}</p>
        <p className="text-xs text-muted-foreground">
          {modo === "resolvida"
            ? "Registra que a pendência foi feita, com o seu nome e o horário."
            : "Registra que a pendência não vai mais ser feita, com o seu nome, o horário e o motivo."}
        </p>
        <div>
          <Label htmlFor="bp-obs">
            {obrigatoria ? "Motivo (obrigatório)" : "Observação (opcional)"}
          </Label>
          <Textarea
            id="bp-obs"
            rows={2}
            maxLength={300}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
          />
          {curta && <p className="mt-1 text-sm text-destructive">Use pelo menos 3 caracteres.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button disabled={falta || curta || salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending
              ? "Salvando…"
              : modo === "resolvida"
                ? "Marcar como resolvida"
                : "Descartar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
