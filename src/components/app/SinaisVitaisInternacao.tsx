import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Pencil } from "lucide-react";
import { toast } from "sonner";

import { ParametrosSinaisDialog } from "@/components/app/ParametrosSinaisDialog";
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
import { supabase } from "@/integrations/supabase/client";
import { dateTimeBR } from "@/lib/format";
import { chaveSinais, historicoSinais } from "@/lib/sinais-vitais-consulta";
import {
  LIMITE_OBSERVACAO,
  agruparSeries,
  cadeiaDoRegistro,
  datetimeLocalAgora,
  descreverRegistro,
  formatarValor,
  isoDeDatetimeLocal,
  lerValor,
  novaChaveEnvio,
  podeCorrigir,
  pontosGrafico,
  validarFormulario,
  type ParametroSinal,
  type RegistroSinal,
  type Serie,
} from "@/lib/sinais-vitais";

const LARGURA = 300;
const ALTURA = 80;

type Props = { internacaoId: string; aberta: boolean; admitidoEm: string; souVet: boolean };

/** Sinais vitais da internação: registro estruturado, evolução por parâmetro e correção sem perda. */
export function SinaisVitaisInternacao({ internacaoId, aberta, admitidoEm, souVet }: Props) {
  const qc = useQueryClient();
  const [gerenciando, setGerenciando] = useState(false);
  const [corrigindo, setCorrigindo] = useState<RegistroSinal | null>(null);

  const historico = useQuery({
    queryKey: chaveSinais(internacaoId),
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: () => historicoSinais(internacaoId),
  });
  const parametros = useQuery({
    queryKey: ["clinica-sinais-parametros", "ativos"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_sinais_parametros");
      if (error) throw error;
      return (data ?? []) as unknown as ParametroSinal[];
    },
  });

  const recarregar = () => void qc.invalidateQueries({ queryKey: chaveSinais(internacaoId) });
  const series = historico.data ? agruparSeries(historico.data.registros) : [];
  const catalogo = parametros.data ?? [];

  return (
    <section aria-labelledby={`sv-${internacaoId}`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={`sv-${internacaoId}`} className="text-sm font-semibold">
          Sinais vitais
        </h4>
        {souVet && (
          <Button size="sm" variant="outline" onClick={() => setGerenciando(true)}>
            Parâmetros
          </Button>
        )}
      </div>

      {aberta && (
        <FormularioRegistro
          internacaoId={internacaoId}
          admitidoEm={admitidoEm}
          catalogo={catalogo}
          carregando={parametros.isLoading}
          souVet={souVet}
          aoGerenciar={() => setGerenciando(true)}
          aoSalvar={recarregar}
        />
      )}

      {historico.isLoading ? (
        <div className="panel h-20 animate-pulse" />
      ) : historico.isError ? (
        <p className="text-sm text-destructive">
          Não foi possível carregar os sinais vitais: {(historico.error as Error).message}
        </p>
      ) : series.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma medida registrada nesta internação. A falta de registro não significa valor zero:
          significa que ninguém mediu.
        </p>
      ) : (
        <div className="space-y-3">
          {series.map((s) => (
            <SerieCard
              key={s.chave}
              serie={s}
              todos={historico.data?.registros ?? []}
              souVet={historico.data?.sou_veterinario ?? false}
              meuId={historico.data?.meu_profissional_id ?? ""}
              aberta={aberta}
              aoCorrigir={setCorrigindo}
            />
          ))}
        </div>
      )}

      {gerenciando && <ParametrosSinaisDialog aoFechar={() => setGerenciando(false)} />}
      {corrigindo && (
        <CorrigirDialog
          registro={corrigindo}
          aoFechar={() => setCorrigindo(null)}
          aoSalvar={() => {
            setCorrigindo(null);
            recarregar();
          }}
        />
      )}
    </section>
  );
}

function FormularioRegistro({
  internacaoId,
  admitidoEm,
  catalogo,
  carregando,
  souVet,
  aoGerenciar,
  aoSalvar,
}: {
  internacaoId: string;
  admitidoEm: string;
  catalogo: ParametroSinal[];
  carregando: boolean;
  souVet: boolean;
  aoGerenciar: () => void;
  aoSalvar: () => void;
}) {
  const id = useId();
  const [parametroId, setParametroId] = useState("");
  const [valorTexto, setValorTexto] = useState("");
  const [naoMedido, setNaoMedido] = useState(false);
  const [observacao, setObservacao] = useState("");
  const [mostrarObs, setMostrarObs] = useState(false);
  // enquanto a pessoa não mexe no horário, vale "agora" (o banco usa o relógio dele); só o horário editado é enviado
  const [medidoEmEditado, setMedidoEmEditado] = useState<string | null>(null);
  const medidoEm = medidoEmEditado ?? datetimeLocalAgora();
  const [chave, setChave] = useState(() => novaChaveEnvio());
  const parametro = catalogo.find((p) => p.id === parametroId);

  const erroBruto = parametroId
    ? validarFormulario({
        parametroId,
        valorTexto: naoMedido ? "" : valorTexto,
        observacao: naoMedido || observacao.trim() ? observacao : "",
        medidoEmLocal: medidoEmEditado ?? "",
        admitidoEm,
      })
    : null;
  // enquanto nada foi digitado, o botão fica desabilitado sem mostrar aviso
  const nadaDigitado = !valorTexto.trim() && !observacao.trim() && !naoMedido;
  const erro =
    erroBruto && nadaDigitado && erroBruto.startsWith("Informe o valor") ? null : erroBruto;

  const registrar = useMutation({
    mutationFn: async () => {
      const valor = naoMedido ? { ok: true as const, valor: null } : lerValor(valorTexto);
      if (!valor.ok) throw new Error(valor.erro);
      const { error } = await supabase.rpc("clinica_sinal_registrar", {
        p_internacao_id: internacaoId,
        p_dados: {
          parametro_id: parametroId,
          ...(valor.valor !== null ? { valor: String(valor.valor) } : {}),
          ...(observacao.trim() ? { observacao: observacao.trim() } : {}),
          ...(medidoEmEditado
            ? { medido_em: isoDeDatetimeLocal(medidoEmEditado) ?? undefined }
            : {}),
          chave,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Medida registrada");
      setValorTexto("");
      setObservacao("");
      setMostrarObs(false);
      setNaoMedido(false);
      setMedidoEmEditado(null);
      setChave(novaChaveEnvio());
      aoSalvar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (carregando) return <div className="panel h-16 animate-pulse" />;
  if (catalogo.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-3 text-sm">
        <p className="text-muted-foreground">
          A clínica ainda não cadastrou parâmetros de sinais vitais (temperatura, frequência
          cardíaca etc.). O sistema não define esses parâmetros por conta própria.
        </p>
        {souVet ? (
          <Button className="mt-2" size="sm" onClick={aoGerenciar}>
            Cadastrar parâmetros
          </Button>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            Peça ao veterinário ou à gestão para cadastrar em Clínica › Boxes de internação.
          </p>
        )}
      </div>
    );
  }

  const incompleto =
    !parametroId || (!naoMedido && !valorTexto.trim()) || (naoMedido && !observacao.trim());
  return (
    <div className="rounded-md border border-border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-par`}>Parâmetro</Label>
          <Select value={parametroId} onValueChange={setParametroId}>
            <SelectTrigger id={`${id}-par`}>
              <SelectValue placeholder="Escolha" />
            </SelectTrigger>
            <SelectContent>
              {catalogo.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nome} ({p.unidade})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor={`${id}-val`}>Valor{parametro ? ` (${parametro.unidade})` : ""}</Label>
          <Input
            id={`${id}-val`}
            inputMode="decimal"
            disabled={naoMedido}
            value={valorTexto}
            onChange={(e) => setValorTexto(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`${id}-quando`}>Horário da medição</Label>
          <Input
            id={`${id}-quando`}
            type="datetime-local"
            value={medidoEm}
            onChange={(e) => setMedidoEmEditado(e.target.value || null)}
          />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={naoMedido}
              onChange={(e) => setNaoMedido(e.target.checked)}
            />
            Não foi possível medir
          </label>
        </div>
        {(naoMedido || mostrarObs || observacao) && (
          <div className="sm:col-span-2">
            <Label htmlFor={`${id}-obs`}>{naoMedido ? "Motivo" : "Observação"}</Label>
            <Textarea
              id={`${id}-obs`}
              rows={2}
              maxLength={LIMITE_OBSERVACAO}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
            />
          </div>
        )}
      </div>
      {erro && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {erro}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={registrar.isPending || incompleto || !!erro}
          onClick={() => registrar.mutate()}
        >
          {registrar.isPending ? "Registrando…" : "Registrar medida"}
        </Button>
        {!naoMedido && !mostrarObs && !observacao && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => setMostrarObs(true)}
          >
            Adicionar observação
          </button>
        )}
      </div>
    </div>
  );
}

function SerieCard({
  serie,
  todos,
  souVet,
  meuId,
  aberta,
  aoCorrigir,
}: {
  serie: Serie;
  todos: RegistroSinal[];
  souVet: boolean;
  meuId: string;
  aberta: boolean;
  aoCorrigir: (r: RegistroSinal) => void;
}) {
  const [verHistorico, setVerHistorico] = useState(false);
  const grafico = pontosGrafico(serie.correntes, LARGURA, ALTURA);
  const recentes = [...serie.correntes].reverse();
  const temCorrecao = serie.historico.length > serie.correntes.length;

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h5 className="text-sm font-semibold">
          {serie.nome} <span className="font-normal text-muted-foreground">({serie.unidade})</span>
        </h5>
        <p className="text-sm">
          {serie.ultimo ? (
            <>
              Última: <strong>{formatarValor(serie.ultimo.valor, serie.ultimo.unidade)}</strong>{" "}
              <span className="text-xs text-muted-foreground">
                {dateTimeBR(serie.ultimo.medido_em)}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">Sem valor medido</span>
          )}
        </p>
      </div>

      {grafico.pontos.length > 0 && (
        <svg
          viewBox={`0 0 ${LARGURA} ${ALTURA}`}
          className="mt-2 h-20 w-full"
          role="img"
          aria-label={`Evolução de ${serie.nome}: ${grafico.pontos.length} medida(s), de ${formatarValor(grafico.min, serie.unidade)} a ${formatarValor(grafico.max, serie.unidade)}`}
        >
          {grafico.pontos.length > 1 && (
            <polyline
              points={grafico.linha}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-primary"
            />
          )}
          {grafico.pontos.map((p) => (
            <circle key={p.id} cx={p.x} cy={p.y} r="3" className="fill-primary">
              <title>{formatarValor(p.valor, serie.unidade)}</title>
            </circle>
          ))}
        </svg>
      )}

      <ul className="mt-2 divide-y divide-border text-sm" aria-label={`Medidas de ${serie.nome}`}>
        {recentes.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-1.5">
            <div className="min-w-0">
              <span className="font-medium">{descreverRegistro(r)}</span>{" "}
              <span className="text-xs text-muted-foreground">
                {dateTimeBR(r.medido_em)} · {r.profissional}
              </span>
              {r.corrige_id && (
                <Badge variant="secondary" className="ml-2">
                  corrigido
                </Badge>
              )}
              {r.corrige_id && r.motivo_correcao && (
                <p className="text-xs text-muted-foreground">Motivo: {r.motivo_correcao}</p>
              )}
              {r.valor !== null && r.observacao && (
                <p className="break-words text-xs text-muted-foreground">{r.observacao}</p>
              )}
            </div>
            {podeCorrigir(r, souVet, meuId, aberta) && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Corrigir ${descreverRegistro(r)} de ${dateTimeBR(r.medido_em)}`}
                onClick={() => aoCorrigir(r)}
              >
                <Pencil className="size-4" /> Corrigir
              </Button>
            )}
          </li>
        ))}
      </ul>

      {temCorrecao && (
        <div className="mt-2">
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground underline"
            onClick={() => setVerHistorico((v) => !v)}
            aria-expanded={verHistorico}
          >
            <History className="size-3" /> {verHistorico ? "Ocultar" : "Ver"} histórico completo (
            {serie.historico.length} registros)
          </button>
          {verHistorico && (
            <ol className="mt-1 space-y-1 text-xs">
              {serie.historico.map((r) => {
                const cadeia = cadeiaDoRegistro(todos, r.id);
                const posicao = cadeia.findIndex((c) => c.id === r.id) + 1;
                return (
                  <li key={r.id} className={r.corrente ? "" : "text-muted-foreground"}>
                    {dateTimeBR(r.medido_em)} · {descreverRegistro(r)} · {r.profissional}
                    {" · registrado "}
                    {dateTimeBR(r.registrado_em)}
                    {r.corrige_id &&
                      ` · correção (versão ${posicao}/${cadeia.length}): ${r.motivo_correcao}`}
                    {r.substituido_por && " · substituído por correção"}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function CorrigirDialog({
  registro,
  aoFechar,
  aoSalvar,
}: {
  registro: RegistroSinal;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [valorTexto, setValorTexto] = useState(
    registro.valor !== null ? String(registro.valor).replace(".", ",") : "",
  );
  // a observação do registro acompanha a correção: a pessoa pode editar ou apagar, mas nada some sem ela escolher
  const [observacao, setObservacao] = useState(registro.observacao ?? "");
  const [anular, setAnular] = useState(false);
  const [motivo, setMotivo] = useState("");

  const valor = lerValor(valorTexto);
  const erroMotivo = motivo.trim().length < 3 ? "Informe o motivo (mínimo 3 caracteres)." : null;
  const erroValor = anular
    ? null
    : !valor.ok
      ? valor.erro
      : valor.valor === null && !observacao.trim()
        ? "Informe o valor corrigido ou explique por que não foi possível medir."
        : null;
  // o botão só habilita sem nenhum erro; o aviso do motivo aparece depois que a pessoa começa a escrevê-lo
  const bloqueado = !!erroValor || !!erroMotivo;
  const erro = erroValor ?? (motivo.length > 0 ? erroMotivo : null);

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("clinica_sinal_corrigir", {
        p_id: registro.id,
        p_dados: anular
          ? { anular: true, motivo: motivo.trim() }
          : {
              motivo: motivo.trim(),
              ...(valor.ok && valor.valor !== null ? { valor: String(valor.valor) } : {}),
              ...(observacao.trim() ? { observacao: observacao.trim() } : {}),
            },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(anular ? "Registro anulado" : "Correção registrada");
      aoSalvar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Corrigir {registro.parametro} ({registro.unidade})
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Registrado: {descreverRegistro(registro)} em {dateTimeBR(registro.medido_em)} por{" "}
          {registro.profissional}. O registro original continua no histórico; a correção é um novo
          registro.
        </p>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={anular} onChange={(e) => setAnular(e.target.checked)} />
            Anular este registro (não vale mais)
          </label>
          {!anular && (
            <>
              <div>
                <Label htmlFor="cs-valor">Valor corrigido ({registro.unidade})</Label>
                <Input
                  id="cs-valor"
                  inputMode="decimal"
                  value={valorTexto}
                  onChange={(e) => setValorTexto(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="cs-obs">
                  {valor.ok && valor.valor === null
                    ? "Por que não foi possível medir"
                    : "Observação (opcional)"}
                </Label>
                <Textarea
                  id="cs-obs"
                  rows={2}
                  maxLength={LIMITE_OBSERVACAO}
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                />
              </div>
            </>
          )}
          <div>
            <Label htmlFor="cs-motivo">Motivo da {anular ? "anulação" : "correção"}</Label>
            <Textarea
              id="cs-motivo"
              rows={2}
              maxLength={300}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
          {erro && (
            <p className="text-sm text-destructive" role="alert">
              {erro}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button disabled={bloqueado || salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending ? "Salvando…" : anular ? "Anular registro" : "Salvar correção"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
