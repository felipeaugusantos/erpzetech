import { useCallback, useEffect, useMemo, useState } from "react";
import { Stethoscope } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CHAVE_CONSUMIDOS,
  PREFIXO_PACIENTE,
  PREFIXO_RASCUNHO,
  pacientesGuardados,
  type PacienteGuardado,
  abrirAtendimento,
  consultasDaCopia,
  operacaoDeFechar,
  operacaoDeSalvar,
  petsDaAgenda,
  rascunhoJaEnviado,
  salvamentosSubstituidos,
  servicosDeConsulta,
  type PacienteParaAtender,
  type RascunhoAtendimento,
} from "@/lib/atendimento-offline";
import { erroDosSinais, faltaParaFechar, type FormAtendimento } from "@/lib/clinica";
import type { Cofre } from "@/lib/cofre";
import type { OperacaoFila } from "@/lib/fila-clinica";
import { dateTimeBR } from "@/lib/format";
import type { CopiaVisita } from "@/lib/visita";

const CAMPOS_TEXTO: { chave: keyof FormAtendimento; rotulo: string; linhas: number }[] = [
  { chave: "queixa", rotulo: "Queixa principal", linhas: 2 },
  { chave: "anamnese", rotulo: "Anamnese", linhas: 3 },
  { chave: "exame_fisico", rotulo: "Exame físico", linhas: 3 },
  { chave: "diagnostico", rotulo: "Diagnóstico", linhas: 2 },
  { chave: "conduta", rotulo: "Conduta", linhas: 3 },
  { chave: "observacoes", rotulo: "Observações", linhas: 2 },
];

const CAMPOS_SINAIS: { chave: keyof FormAtendimento; rotulo: string }[] = [
  { chave: "peso_kg", rotulo: "Peso (kg)" },
  { chave: "temperatura_c", rotulo: "Temperatura (°C)" },
  { chave: "freq_cardiaca", rotulo: "Freq. cardíaca" },
  { chave: "freq_respiratoria", rotulo: "Freq. respiratória" },
];

/**
 * Atendimento da visita, com ou sem internet: abre a consulta marcada (ou uma visita sem consulta marcada), guarda o texto no cofre a cada
 * salvamento e fecha. Tudo entra na fila e sai quando houver sinal; depois de fechado, o atendimento só se lê.
 */
export function AtendimentosVisita({
  cofre,
  copia,
  fila,
  online,
  aoGuardar,
}: {
  cofre: Cofre;
  copia: CopiaVisita | null;
  fila: OperacaoFila[];
  online: boolean;
  aoGuardar: () => Promise<void>;
}) {
  const [rascunhos, setRascunhos] = useState<RascunhoAtendimento[]>([]);
  const [guardados, setGuardados] = useState<PacienteGuardado[]>([]);
  const [consumidos, setConsumidos] = useState<string[]>([]);
  const [editando, setEditando] = useState<string | null>(null);
  const [pacienteSel, setPacienteSel] = useState("");
  const [servicoSel, setServicoSel] = useState("");

  const carregar = useCallback(async () => {
    const { itens } = await cofre.listar<unknown>("copia");
    let usados = (itens.find(([k]) => k === CHAVE_CONSUMIDOS)?.[1] as string[] | undefined) ?? [];
    const lista: RascunhoAtendimento[] = [];
    for (const [chave, valor] of itens) {
      if (!chave.startsWith(PREFIXO_RASCUNHO)) continue;
      const r = valor as RascunhoAtendimento;
      // fechado e já enviado: o servidor guarda, o notebook solta (e lembra só que a consulta marcada já foi atendida)
      if (rascunhoJaEnviado(r, fila)) {
        if (r.agendamentoId && !usados.includes(r.agendamentoId)) {
          usados = [...usados, r.agendamentoId];
          await cofre.gravar("copia", CHAVE_CONSUMIDOS, usados);
        }
        await cofre.apagar("copia", chave);
      } else lista.push(r);
    }
    setConsumidos(usados);
    setGuardados(
      itens.filter(([k]) => k.startsWith(PREFIXO_PACIENTE)).map(([, p]) => p as PacienteGuardado),
    );
    setRascunhos(lista.sort((a, b) => b.abertoEm.localeCompare(a.abertoEm)));
  }, [cofre, fila]);

  useEffect(() => {
    void carregar().catch((e: Error) =>
      toast.error("Não foi possível ler os atendimentos", { description: e.message }),
    );
  }, [carregar]);

  const comRascunho = new Set([
    ...rascunhos.map((r) => r.agendamentoId).filter(Boolean),
    ...consumidos,
  ]);
  const consultas = copia
    ? consultasDaCopia(copia).filter((c) => !comRascunho.has(c.agendamentoId))
    : [];
  const servicos = copia ? servicosDeConsulta(copia) : [];
  const pacientes = useMemo(() => {
    const lista = pacientesGuardados(guardados, fila);
    const ids = new Set(lista.map((p) => p.petId));
    for (const p of copia ? petsDaAgenda(copia) : []) if (!ids.has(p.petId)) lista.push(p);
    return lista;
  }, [guardados, fila, copia]);

  async function iniciar(origem: Parameters<typeof abrirAtendimento>[0]) {
    try {
      const { rascunho, operacao } = abrirAtendimento(origem);
      // primeiro a operação, depois o rascunho: se cair no meio, o banco ainda recebe o registro
      await cofre.gravar("fila", operacao.id, operacao);
      await cofre.gravar("copia", PREFIXO_RASCUNHO + rascunho.atendimentoId, rascunho);
      await aoGuardar();
      setEditando(rascunho.atendimentoId);
      toast.success(online ? "Atendimento aberto" : "Atendimento aberto no cofre");
    } catch (e) {
      toast.error("Não foi possível abrir o atendimento", { description: (e as Error).message });
    }
  }

  const atual = rascunhos.find((r) => r.atendimentoId === editando) ?? null;

  async function guardar(r: RascunhoAtendimento, form: FormAtendimento, fechar: boolean) {
    const { itens } = await cofre.listar<OperacaoFila>("fila");
    const naFila = itens.map(([, op]) => op);
    const salvar = operacaoDeSalvar(r, form);
    await cofre.gravar("fila", salvar.id, salvar);
    for (const id of salvamentosSubstituidos(naFila, r.atendimentoId))
      await cofre.apagar("fila", id);
    if (fechar) {
      const op = operacaoDeFechar(r, salvar.id);
      await cofre.gravar("fila", op.id, op);
    }
    await cofre.gravar("copia", PREFIXO_RASCUNHO + r.atendimentoId, {
      ...r,
      form,
      fechado: fechar || r.fechado,
    });
    await aoGuardar();
  }

  return (
    <div className="panel grid gap-3 p-4">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <Stethoscope className="size-5" /> Atendimentos da visita
      </h2>
      <p className="text-sm text-muted-foreground">
        Atenda a consulta marcada ou registre uma visita sem consulta marcada (cobrada pelo preço do
        serviço). O texto fica guardado no cofre a cada salvamento; ao fechar, o atendimento não se
        altera mais e a recepção cobra.
      </p>

      {!copia && (
        <p className="text-sm text-muted-foreground">
          Prepare a visita (com internet) para ver as consultas da agenda.
        </p>
      )}

      {consultas.length > 0 && (
        <div className="grid gap-2">
          <p className="text-sm font-medium">Consultas da agenda</p>
          <ul className="grid gap-2 text-sm">
            {consultas.map((c) => (
              <li
                key={c.agendamentoId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
              >
                <span>
                  <strong>{c.petNome}</strong> · tutor {c.tutorNome} · {dateTimeBR(c.inicio)}
                </span>
                <Button
                  size="sm"
                  onClick={() => void iniciar({ tipo: "consulta_marcada", consulta: c })}
                >
                  Atender
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pacientes.length > 0 && (
        <div className="grid gap-2 rounded-md border p-3">
          <p className="text-sm font-medium">Visita sem consulta marcada</p>
          {servicos.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Esta cópia não traz serviços de consulta: prepare a visita de novo (com internet).
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-60">
                <Label htmlFor="av-pet">Paciente</Label>
                <Select value={pacienteSel} onValueChange={setPacienteSel}>
                  <SelectTrigger id="av-pet">
                    <SelectValue placeholder="Escolha" />
                  </SelectTrigger>
                  <SelectContent>
                    {pacientes.map((p) => (
                      <SelectItem key={p.petId} value={p.petId}>
                        {p.petNome} · {p.tutorNome}
                        {p.cadastroOpId ? " (novo)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-60">
                <Label htmlFor="av-srv">Serviço</Label>
                <Select value={servicoSel} onValueChange={setServicoSel}>
                  <SelectTrigger id="av-srv">
                    <SelectValue placeholder="Escolha" />
                  </SelectTrigger>
                  <SelectContent>
                    {servicos.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                disabled={!pacienteSel || !servicoSel}
                onClick={() => {
                  const paciente = pacientes.find((p) => p.petId === pacienteSel);
                  if (paciente)
                    void iniciar({ tipo: "visita_avulsa", paciente, servicoId: servicoSel });
                }}
              >
                Atender
              </Button>
            </div>
          )}
        </div>
      )}

      {rascunhos.length > 0 && (
        <div className="grid gap-2">
          <p className="text-sm font-medium">Neste notebook</p>
          <ul className="grid gap-2 text-sm">
            {rascunhos.map((r) => (
              <li
                key={r.atendimentoId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
              >
                <span>
                  <strong>{r.petNome}</strong> · tutor {r.tutorNome} · aberto em{" "}
                  {dateTimeBR(r.abertoEm)}
                  {r.modo === "visita_avulsa" ? " · sem consulta marcada" : ""}
                </span>
                <span className="flex items-center gap-2">
                  <Badge variant={r.fechado ? "default" : "outline"}>
                    {r.fechado ? "Fechado" : "Em andamento"}
                  </Badge>
                  <Button size="sm" variant="outline" onClick={() => setEditando(r.atendimentoId)}>
                    {r.fechado ? "Ver" : "Continuar"}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {atual && (
        <FormularioAtendimento
          key={atual.atendimentoId}
          rascunho={atual}
          aoSalvar={async (form, fechar) => {
            try {
              await guardar(atual, form, fechar);
              toast.success(fechar ? "Atendimento fechado" : "Atendimento salvo");
              if (fechar) setEditando(null);
            } catch (e) {
              toast.error("Não foi possível guardar", { description: (e as Error).message });
            }
          }}
          aoFechar={() => setEditando(null)}
        />
      )}
    </div>
  );
}

function FormularioAtendimento({
  rascunho,
  aoSalvar,
  aoFechar,
}: {
  rascunho: RascunhoAtendimento;
  aoSalvar: (form: FormAtendimento, fechar: boolean) => Promise<void>;
  aoFechar: () => void;
}) {
  const [form, setForm] = useState<FormAtendimento>(rascunho.form);
  const [trabalhando, setTrabalhando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const somenteLeitura = rascunho.fechado;
  const falta = faltaParaFechar(form);
  const erroSinais = erroDosSinais(form);
  const mexe = (chave: keyof FormAtendimento, v: string) => setForm((f) => ({ ...f, [chave]: v }));

  async function rodar(fechar: boolean) {
    setTrabalhando(true);
    try {
      await aoSalvar(form, fechar);
    } finally {
      setTrabalhando(false);
      setConfirmando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {rascunho.petNome} · tutor {rascunho.tutorNome}
          </DialogTitle>
        </DialogHeader>
        {somenteLeitura && (
          <p className="rounded-md border px-3 py-2 text-sm">
            Atendimento fechado neste notebook: não se altera mais. Para complementar, registre um
            adendo depois que ele for enviado.
          </p>
        )}
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-4">
            {CAMPOS_SINAIS.map((c) => (
              <div key={c.chave}>
                <Label htmlFor={`at-${c.chave}`}>{c.rotulo}</Label>
                <Input
                  id={`at-${c.chave}`}
                  inputMode="decimal"
                  disabled={somenteLeitura}
                  value={form[c.chave]}
                  onChange={(e) => mexe(c.chave, e.target.value)}
                />
              </div>
            ))}
          </div>
          {CAMPOS_TEXTO.map((c) => (
            <div key={c.chave}>
              <Label htmlFor={`at-${c.chave}`}>{c.rotulo}</Label>
              <Textarea
                id={`at-${c.chave}`}
                rows={c.linhas}
                disabled={somenteLeitura}
                value={form[c.chave]}
                onChange={(e) => mexe(c.chave, e.target.value)}
              />
            </div>
          ))}
          <div className="w-48">
            <Label htmlFor="at-retorno">Retorno em</Label>
            <Input
              id="at-retorno"
              type="date"
              disabled={somenteLeitura}
              value={form.retorno_em}
              onChange={(e) => mexe("retorno_em", e.target.value)}
            />
          </div>
          {erroSinais && <p className="text-sm text-destructive">{erroSinais}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            {somenteLeitura ? "Voltar" : "Fechar a janela"}
          </Button>
          {!somenteLeitura && (
            <>
              <Button
                variant="outline"
                disabled={trabalhando || !!erroSinais}
                onClick={() => void rodar(false)}
              >
                Salvar
              </Button>
              <Button
                disabled={trabalhando || !!erroSinais || falta.length > 0}
                title={falta.length > 0 ? `Falta: ${falta.join(", ")}` : undefined}
                onClick={() => setConfirmando(true)}
              >
                Fechar atendimento
              </Button>
            </>
          )}
        </DialogFooter>
        {confirmando && (
          <Dialog open onOpenChange={(o) => !o && setConfirmando(false)}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Fechar o atendimento?</DialogTitle>
              </DialogHeader>
              <p className="text-sm">
                Depois de fechado o atendimento não se altera mais. Só um adendo poderá
                complementá-lo.
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmando(false)}>
                  Voltar
                </Button>
                <Button disabled={trabalhando} onClick={() => void rodar(true)}>
                  Fechar mesmo assim
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
