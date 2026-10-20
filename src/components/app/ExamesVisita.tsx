import { useCallback, useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
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
import { usePacientesVisita } from "@/hooks/usePacientesVisita";
import { PREFIXO_RASCUNHO, type RascunhoAtendimento } from "@/lib/atendimento-offline";
import type { Cofre } from "@/lib/cofre";
import {
  PREFIXO_EXAME,
  abrirExame,
  camposPreenchidos,
  erroDaAbertura,
  erroDoExame,
  exameJaEnviado,
  modelosDaCopia,
  operacaoDeFecharExame,
  operacaoDeSalvarExame,
  salvamentosSubstituidosExame,
  temResultado,
  type FormExame,
  type RascunhoExame,
} from "@/lib/exame-offline";
import { agruparCampos, rotuloFaixa } from "@/lib/exames";
import type { OperacaoFila } from "@/lib/fila-clinica";
import { dateTimeBR } from "@/lib/format";
import { hojeISO } from "@/lib/financeiro";
import type { CopiaVisita } from "@/lib/visita";

const SEM_ATENDIMENTO = "__avulso";

/**
 * Exame da visita, com ou sem internet: abre a partir de um modelo baixado, preenche e fecha. O texto fica no cofre a cada salvamento;
 * os campos calculados (total × percentual) são calculados pelo banco quando o exame é enviado.
 */
export function ExamesVisita({
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
  const pacientes = usePacientesVisita(cofre, copia, fila);
  const [exames, setExames] = useState<RascunhoExame[]>([]);
  const [atendimentos, setAtendimentos] = useState<RascunhoAtendimento[]>([]);
  const [editando, setEditando] = useState<string | null>(null);
  const [petId, setPetId] = useState("");
  const [modeloId, setModeloId] = useState("");
  const [atendId, setAtendId] = useState(SEM_ATENDIMENTO);
  const [lab, setLab] = useState("");
  const [material, setMaterial] = useState("");
  const [coleta, setColeta] = useState(hojeISO());
  const hoje = hojeISO();

  const carregar = useCallback(async () => {
    const { itens } = await cofre.listar<unknown>("copia");
    const lista: RascunhoExame[] = [];
    const atend: RascunhoAtendimento[] = [];
    for (const [chave, valor] of itens) {
      if (chave.startsWith(PREFIXO_EXAME)) {
        const r = valor as RascunhoExame;
        // fechado e já enviado: o servidor guarda, o notebook solta
        if (exameJaEnviado(r, fila)) await cofre.apagar("copia", chave);
        else lista.push(r);
      } else if (chave.startsWith(PREFIXO_RASCUNHO)) atend.push(valor as RascunhoAtendimento);
    }
    setExames(lista.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)));
    setAtendimentos(atend);
  }, [cofre, fila]);

  useEffect(() => {
    void carregar().catch((e: Error) =>
      toast.error("Não foi possível ler os exames", { description: e.message }),
    );
  }, [carregar]);

  const modelos = copia ? modelosDaCopia(copia) : [];
  const paciente = pacientes.find((p) => p.petId === petId) ?? null;
  const modelo = modelos.find((m) => m.id === modeloId) ?? null;
  const atendDoPet = atendimentos.filter((a) => a.petId === petId && !a.fechado);
  const atendimento = atendDoPet.find((a) => a.atendimentoId === atendId) ?? null;
  const erroAbertura = erroDaAbertura(
    {
      laboratorio: lab,
      material,
      dataColeta: coleta,
      atendimentoId: atendimento?.atendimentoId ?? null,
    },
    hoje,
  );

  async function abrir() {
    if (!paciente || !modelo || erroAbertura) return;
    try {
      const { rascunho, operacao } = abrirExame(
        paciente,
        modelo,
        {
          laboratorio: lab,
          material: material || (modelo.material ?? ""),
          dataColeta: coleta,
          atendimentoId: atendimento?.atendimentoId ?? null,
        },
        atendimento?.registrarOpId,
      );
      // primeiro a operação, depois o rascunho: se cair no meio, o banco ainda recebe a abertura
      await cofre.gravar("fila", operacao.id, operacao);
      await cofre.gravar("copia", PREFIXO_EXAME + rascunho.abrirOpId, rascunho);
      await aoGuardar();
      setLab("");
      setMaterial("");
      setEditando(rascunho.abrirOpId);
      toast.success(online ? "Exame aberto" : "Exame aberto no cofre");
    } catch (e) {
      toast.error("Não foi possível abrir o exame", { description: (e as Error).message });
    }
  }

  const atual = exames.find((x) => x.abrirOpId === editando) ?? null;

  async function guardar(r: RascunhoExame, form: FormExame, fechar: boolean) {
    const { itens } = await cofre.listar<OperacaoFila>("fila");
    const naFila = itens.map(([, op]) => op);
    const salvar = operacaoDeSalvarExame(r, form);
    await cofre.gravar("fila", salvar.id, salvar);
    for (const id of salvamentosSubstituidosExame(naFila, r.abrirOpId))
      await cofre.apagar("fila", id);
    if (fechar) {
      const op = operacaoDeFecharExame(r, salvar.id);
      await cofre.gravar("fila", op.id, op);
    }
    await cofre.gravar("copia", PREFIXO_EXAME + r.abrirOpId, {
      ...r,
      form,
      fechado: fechar || r.fechado,
    });
    await aoGuardar();
  }

  return (
    <div className="panel grid gap-3 p-4">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <FlaskConical className="size-5" /> Exames da visita
      </h2>
      <p className="text-sm text-muted-foreground">
        Abra um exame a partir dos modelos baixados, preencha e feche. Ao fechar, o exame não se
        altera mais. Os valores calculados aparecem depois do envio.
      </p>
      {!copia ? (
        <p className="text-sm text-muted-foreground">
          Prepare a visita (com internet) para ter os modelos de exame.
        </p>
      ) : modelos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum modelo de exame ativo na cópia.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="ex-pet">Paciente</Label>
            <Select
              value={petId}
              onValueChange={(v) => {
                setPetId(v);
                setAtendId(SEM_ATENDIMENTO);
              }}
            >
              <SelectTrigger id="ex-pet">
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
          <div>
            <Label htmlFor="ex-modelo">Modelo do exame</Label>
            <Select value={modeloId} onValueChange={setModeloId}>
              <SelectTrigger id="ex-modelo">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                {modelos.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="ex-atend">Atendimento</Label>
            <Select value={atendId} onValueChange={setAtendId} disabled={!paciente}>
              <SelectTrigger id="ex-atend">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_ATENDIMENTO}>Exame avulso (de laboratório)</SelectItem>
                {atendDoPet.map((a) => (
                  <SelectItem key={a.atendimentoId} value={a.atendimentoId}>
                    Atendimento aberto em {dateTimeBR(a.abertoEm)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="ex-lab">Laboratório{atendimento ? " (opcional)" : ""}</Label>
            <Input
              id="ex-lab"
              value={lab}
              maxLength={120}
              onChange={(e) => setLab(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="ex-material">Material</Label>
            <Input
              id="ex-material"
              placeholder={modelo?.material ?? ""}
              value={material}
              maxLength={80}
              onChange={(e) => setMaterial(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="ex-coleta">Data da coleta</Label>
            <Input
              id="ex-coleta"
              type="date"
              value={coleta}
              max={hoje}
              onChange={(e) => setColeta(e.target.value)}
            />
          </div>
          {paciente && modelo && erroAbertura && (
            <p className="text-sm text-destructive sm:col-span-2">{erroAbertura}</p>
          )}
          <div className="sm:col-span-2">
            <Button onClick={() => void abrir()} disabled={!paciente || !modelo || !!erroAbertura}>
              Abrir exame
            </Button>
          </div>
        </div>
      )}

      {exames.length > 0 && (
        <div className="grid gap-2">
          <p className="text-sm font-medium">Neste notebook</p>
          <ul className="grid gap-2 text-sm">
            {exames.map((x) => (
              <li
                key={x.abrirOpId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
              >
                <span>
                  <strong>{x.modelo.nome}</strong> · {x.petNome} · tutor {x.tutorNome} · aberto em{" "}
                  {dateTimeBR(x.criadoEm)}
                </span>
                <span className="flex items-center gap-2">
                  <Badge variant={x.fechado ? "default" : "outline"}>
                    {x.fechado ? "Fechado" : "Em andamento"}
                  </Badge>
                  <Button size="sm" variant="outline" onClick={() => setEditando(x.abrirOpId)}>
                    {x.fechado ? "Ver" : "Continuar"}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {atual && (
        <FormularioExame
          key={atual.abrirOpId}
          rascunho={atual}
          aoSalvar={async (form, fechar) => {
            try {
              await guardar(atual, form, fechar);
              toast.success(fechar ? "Exame fechado" : "Exame salvo");
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

function FormularioExame({
  rascunho,
  aoSalvar,
  aoFechar,
}: {
  rascunho: RascunhoExame;
  aoSalvar: (form: FormExame, fechar: boolean) => Promise<void>;
  aoFechar: () => void;
}) {
  const [form, setForm] = useState<FormExame>(rascunho.form);
  const [trabalhando, setTrabalhando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const somenteLeitura = rascunho.fechado;
  const erro =
    erroDaAbertura(
      {
        laboratorio: form.laboratorio,
        material: form.material,
        dataColeta: form.dataColeta,
        atendimentoId: rascunho.atendimentoId,
      },
      hojeISO(),
    ) ?? erroDoExame(form, rascunho.modelo);
  const faltaResultado = !temResultado(form, rascunho.modelo);
  const faixaDaEspecie = (campoId: string) => {
    const c = rascunho.modelo.campos.find((x) => x.id === campoId);
    return c?.referencias.find((r) => r.especie === rascunho.especie);
  };

  const mexe = (campoId: string, parte: Partial<{ valor: string; nota: string }>) =>
    setForm((f) => ({
      ...f,
      valores: {
        ...f.valores,
        [campoId]: { valor: "", nota: "", ...f.valores[campoId], ...parte },
      },
    }));

  async function rodar(fechar: boolean) {
    setTrabalhando(true);
    try {
      await aoSalvar(form, fechar);
    } finally {
      setTrabalhando(false);
      setConfirmando(false);
    }
  }

  const grupos = agruparCampos(camposPreenchidos(rascunho.modelo));

  return (
    <Dialog open onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {rascunho.modelo.nome} · {rascunho.petNome}
          </DialogTitle>
        </DialogHeader>
        {somenteLeitura && (
          <p className="rounded-md border px-3 py-2 text-sm">
            Exame fechado neste notebook: não se altera mais. Para complementar, registre um adendo
            depois que ele for enviado.
          </p>
        )}
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="fx-lab">Laboratório</Label>
              <Input
                id="fx-lab"
                disabled={somenteLeitura}
                value={form.laboratorio}
                onChange={(e) => setForm((f) => ({ ...f, laboratorio: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="fx-material">Material</Label>
              <Input
                id="fx-material"
                disabled={somenteLeitura}
                value={form.material}
                onChange={(e) => setForm((f) => ({ ...f, material: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="fx-coleta">Coleta</Label>
              <Input
                id="fx-coleta"
                type="date"
                disabled={somenteLeitura}
                value={form.dataColeta}
                onChange={(e) => setForm((f) => ({ ...f, dataColeta: e.target.value }))}
              />
            </div>
          </div>
          {grupos.map((g) => (
            <div key={g.grupo || "_"} className="grid gap-2">
              {g.grupo && <p className="text-sm font-medium">{g.grupo}</p>}
              {g.campos.map((c) => {
                const v = form.valores[c.id] ?? { valor: "", nota: "" };
                return (
                  <div key={c.id} className="grid gap-1 rounded-md border p-2 sm:grid-cols-3">
                    <Label htmlFor={`fc-${c.id}`} className="sm:pt-2">
                      {c.nome}
                      {c.unidade ? ` (${c.unidade})` : ""}
                      {c.forma === "numero" && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          Referência: {rotuloFaixa(faixaDaEspecie(c.id), c.unidade)}
                        </span>
                      )}
                    </Label>
                    {c.forma === "escolha" ? (
                      <Select
                        value={v.valor || "__nada"}
                        disabled={somenteLeitura}
                        onValueChange={(x) => mexe(c.id, { valor: x === "__nada" ? "" : x })}
                      >
                        <SelectTrigger id={`fc-${c.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__nada">—</SelectItem>
                          {(c.opcoes ?? []).map((o) => (
                            <SelectItem key={o} value={o}>
                              {o}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id={`fc-${c.id}`}
                        inputMode={c.forma === "numero" ? "decimal" : undefined}
                        disabled={somenteLeitura}
                        value={v.valor}
                        onChange={(e) => mexe(c.id, { valor: e.target.value })}
                      />
                    )}
                    <Input
                      aria-label={`Nota de ${c.nome}`}
                      placeholder="Nota"
                      disabled={somenteLeitura}
                      value={v.nota}
                      onChange={(e) => mexe(c.id, { nota: e.target.value })}
                    />
                  </div>
                );
              })}
            </div>
          ))}
          <div>
            <Label htmlFor="fx-obs">Observações</Label>
            <Textarea
              id="fx-obs"
              rows={3}
              disabled={somenteLeitura}
              value={form.observacoes}
              onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))}
            />
          </div>
          {erro && <p className="text-sm text-destructive">{erro}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            {somenteLeitura ? "Voltar" : "Fechar a janela"}
          </Button>
          {!somenteLeitura && (
            <>
              <Button
                variant="outline"
                disabled={trabalhando || !!erro}
                onClick={() => void rodar(false)}
              >
                Salvar
              </Button>
              <Button
                disabled={trabalhando || !!erro || faltaResultado}
                title={faltaResultado ? "Preencha ao menos um resultado" : undefined}
                onClick={() => setConfirmando(true)}
              >
                Fechar exame
              </Button>
            </>
          )}
        </DialogFooter>
        {confirmando && (
          <Dialog open onOpenChange={(o) => !o && setConfirmando(false)}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Fechar o exame?</DialogTitle>
              </DialogHeader>
              <p className="text-sm">
                Depois de fechado o exame não se altera mais. Só um adendo poderá complementá-lo.
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
