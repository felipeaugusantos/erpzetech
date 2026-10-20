import { useMemo, useState } from "react";
import { Syringe } from "lucide-react";
import { toast } from "sonner";

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
import { usePacientesVisita } from "@/hooks/usePacientesVisita";
import type { Cofre } from "@/lib/cofre";
import type { OperacaoFila } from "@/lib/fila-clinica";
import { dateTimeBR } from "@/lib/format";
import { hojeISO } from "@/lib/financeiro";
import {
  aplicacaoVazia,
  consultasDeVacina,
  erroDaAplicacao,
  erroDaExterna,
  externaVazia,
  itemPorId,
  itensDaCopia,
  lotesDisponiveis,
  operacaoDeAplicar,
  operacaoDeExterna,
  servicosDeVacina,
  trocarLote,
  type DestinoDaAplicacao,
  type FormAplicacao,
  type FormExterna,
} from "@/lib/vacina-offline";
import type { CopiaVisita } from "@/lib/visita";

const dataBR = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Vacina e vermífugo da visita, com ou sem internet: aplicar (numa consulta de vacina da agenda ou sem agendamento) e registrar a
 * aplicada em outro local. Fica na fila e sai quando há sinal; o banco confere o lote de novo e, se acabou, a operação fica
 * guardada para escolher outro lote nas pendências.
 */
export function VacinasVisita({
  cofre,
  copia,
  fila,
  online,
  aplicadas,
  aoGuardar,
}: {
  cofre: Cofre;
  copia: CopiaVisita | null;
  fila: OperacaoFila[];
  online: boolean;
  /** Doses já enviadas por lote desde que a cópia foi baixada. */
  aplicadas: Record<string, number>;
  aoGuardar: () => Promise<void>;
}) {
  const pacientes = usePacientesVisita(cofre, copia, fila);
  const [petId, setPetId] = useState("");
  const [modo, setModo] = useState<"aplicar" | "externa">("aplicar");
  const [destino, setDestino] = useState("");
  const [aplic, setAplic] = useState<FormAplicacao>(() => aplicacaoVazia(hojeISO()));
  const [ext, setExt] = useState<FormExterna>(() => externaVazia(hojeISO()));
  const [guardando, setGuardando] = useState(false);
  const hoje = hojeISO();

  const paciente = pacientes.find((p) => p.petId === petId) ?? null;
  const itens = useMemo(
    () => (copia && paciente ? itensDaCopia(copia, paciente.especie) : []),
    [copia, paciente],
  );
  const consultas = useMemo(
    () =>
      copia && paciente ? consultasDeVacina(copia).filter((c) => c.petId === paciente.petId) : [],
    [copia, paciente],
  );
  const servicos = copia ? servicosDeVacina(copia) : [];
  const opcoesDestino = [
    ...consultas.map((c) => ({
      valor: `agenda:${c.agendamentoId}`,
      rotulo: `Consulta de vacina de ${dateTimeBR(c.inicio)}`,
    })),
    ...servicos.map((s) => ({ valor: `servico:${s.id}`, rotulo: `Sem agendamento: ${s.nome}` })),
  ];
  const destinoAtual = opcoesDestino.find((o) => o.valor === destino) ?? opcoesDestino[0] ?? null;
  const itemAplic = itens.find((i) => i.id === aplic.catalogoId) ?? null;
  const lotes = itemAplic ? lotesDisponiveis(itemAplic, fila, hoje, aplicadas) : [];
  const erro =
    modo === "aplicar"
      ? (erroDaAplicacao(aplic, hoje) ?? (destinoAtual ? null : "Sem serviço de vacina na cópia"))
      : erroDaExterna(ext, hoje);

  function destinoDaOpcao(valor: string): DestinoDaAplicacao {
    const [tipo, id = ""] = valor.split(":");
    return tipo === "agenda"
      ? { tipo: "agenda", agendamentoId: id }
      : { tipo: "avulsa", servicoId: id };
  }

  async function guardar() {
    if (!paciente || erro) return;
    setGuardando(true);
    try {
      if (modo === "aplicar") {
        if (!itemAplic || !destinoAtual) return;
        const op = operacaoDeAplicar(
          paciente,
          destinoDaOpcao(destinoAtual.valor),
          itemAplic,
          aplic,
        );
        await cofre.gravar("fila", op.id, op);
        setAplic(aplicacaoVazia(hoje));
      } else {
        const item = itens.find((i) => i.id === ext.catalogoId);
        if (!item) return;
        const op = operacaoDeExterna(paciente, item, ext);
        await cofre.gravar("fila", op.id, op);
        setExt(externaVazia(hoje));
      }
      await aoGuardar();
      toast.success(
        online
          ? "Vacina guardada: será enviada agora"
          : "Vacina guardada no cofre: sai com a internet",
      );
    } catch (e) {
      toast.error("Não foi possível guardar", { description: (e as Error).message });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel grid gap-3 p-4">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <Syringe className="size-5" /> Vacinas e vermífugos da visita
      </h2>
      <p className="text-sm text-muted-foreground">
        Registre a dose aplicada agora ou a que o tutor já tinha recebido em outro lugar. O lote vem
        da cópia da visita; o saldo é conferido de novo na hora de enviar. Se o lote acabou, a dose
        fica guardada nas pendências para você escolher outro lote.
      </p>
      {!copia ? (
        <p className="text-sm text-muted-foreground">
          Prepare a visita (com internet) para ter o catálogo e os lotes.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="vc-pet">Paciente</Label>
              <Select
                value={petId}
                onValueChange={(v) => {
                  setPetId(v);
                  setAplic(aplicacaoVazia(hoje));
                  setExt(externaVazia(hoje));
                }}
              >
                <SelectTrigger id="vc-pet">
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
              <Label htmlFor="vc-modo">O que registrar</Label>
              <Select value={modo} onValueChange={(v) => setModo(v as "aplicar" | "externa")}>
                <SelectTrigger id="vc-modo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="aplicar">Dose aplicada agora (baixa o lote)</SelectItem>
                  <SelectItem value="externa">Aplicada em outro local (sem baixa)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {paciente && modo === "aplicar" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="vc-destino">Atendimento</Label>
                <Select value={destinoAtual?.valor ?? ""} onValueChange={setDestino}>
                  <SelectTrigger id="vc-destino">
                    <SelectValue placeholder="Sem serviço de vacina na cópia" />
                  </SelectTrigger>
                  <SelectContent>
                    {opcoesDestino.map((o) => (
                      <SelectItem key={o.valor} value={o.valor}>
                        {o.rotulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="vc-item">Vacina ou vermífugo</Label>
                <Select
                  value={aplic.catalogoId}
                  onValueChange={(v) => setAplic((f) => ({ ...f, catalogoId: v, loteId: "" }))}
                >
                  <SelectTrigger id="vc-item">
                    <SelectValue placeholder="Escolha" />
                  </SelectTrigger>
                  <SelectContent>
                    {itens.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="vc-lote">Lote</Label>
                <Select
                  value={aplic.loteId}
                  onValueChange={(v) => setAplic((f) => ({ ...f, loteId: v }))}
                  disabled={!itemAplic}
                >
                  <SelectTrigger id="vc-lote">
                    <SelectValue placeholder={itemAplic ? "Escolha" : "Escolha o item antes"} />
                  </SelectTrigger>
                  <SelectContent>
                    {lotes.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.lote} · vence {dataBR(l.validade)} · {l.saldo} dose(s)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {itemAplic && lotes.length === 0 && (
                  <p className="mt-1 text-xs text-destructive">
                    Nenhum lote com saldo na validade na cópia desta visita.
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="vc-data">Data da aplicação</Label>
                <Input
                  id="vc-data"
                  type="date"
                  value={aplic.aplicadaEm}
                  max={hoje}
                  onChange={(e) => setAplic((f) => ({ ...f, aplicadaEm: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="vc-local">Local da aplicação</Label>
                <Input
                  id="vc-local"
                  value={aplic.localAplicacao}
                  maxLength={80}
                  onChange={(e) => setAplic((f) => ({ ...f, localAplicacao: e.target.value }))}
                />
              </div>
            </div>
          )}

          {paciente && modo === "externa" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="ve-item">Vacina ou vermífugo</Label>
                <Select
                  value={ext.catalogoId}
                  onValueChange={(v) => setExt((f) => ({ ...f, catalogoId: v }))}
                >
                  <SelectTrigger id="ve-item">
                    <SelectValue placeholder="Escolha" />
                  </SelectTrigger>
                  <SelectContent>
                    {itens.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="ve-data">Data da aplicação</Label>
                <Input
                  id="ve-data"
                  type="date"
                  value={ext.aplicadaEm}
                  max={hoje}
                  onChange={(e) => setExt((f) => ({ ...f, aplicadaEm: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="ve-quem">Quem informou</Label>
                <Input
                  id="ve-quem"
                  placeholder="tutor, carteira, outra clínica"
                  value={ext.informadoPor}
                  onChange={(e) => setExt((f) => ({ ...f, informadoPor: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="ve-lote">Lote (se souber)</Label>
                <Input
                  id="ve-lote"
                  value={ext.lote}
                  onChange={(e) => setExt((f) => ({ ...f, lote: e.target.value }))}
                />
              </div>
            </div>
          )}

          {paciente && erro && (aplic.catalogoId || ext.catalogoId) && (
            <p className="text-sm text-destructive">{erro}</p>
          )}
          <div>
            <Button onClick={() => void guardar()} disabled={!paciente || !!erro || guardando}>
              {guardando ? "Guardando…" : "Guardar vacina"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Troca o lote de uma aplicação que o banco recusou (por exemplo, porque o lote acabou) e a devolve para a fila com a mesma chave. */
export function TrocarLoteDialog({
  operacao,
  copia,
  fila,
  aplicadas,
  aoTrocar,
  aoFechar,
}: {
  operacao: OperacaoFila;
  copia: CopiaVisita | null;
  fila: OperacaoFila[];
  aplicadas: Record<string, number>;
  aoTrocar: (nova: OperacaoFila) => Promise<void>;
  aoFechar: () => void;
}) {
  const [loteId, setLoteId] = useState("");
  const [trabalhando, setTrabalhando] = useState(false);
  const catalogoId = (operacao.payload as { catalogo_id?: string } | null)?.catalogo_id ?? "";
  const item = copia ? itemPorId(copia, catalogoId) : null;
  const lotes = item
    ? lotesDisponiveis(
        item,
        fila.filter((o) => o.id !== operacao.id),
        hojeISO(),
        aplicadas,
      )
    : [];
  return (
    <Dialog open onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Escolher outro lote</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2 text-sm">
          <p>
            <strong>{operacao.descricao}</strong> foi recusada: {operacao.erro}
          </p>
          {!item ? (
            <p className="text-amber-800">
              A cópia da visita não tem mais este item. Prepare a visita de novo (com internet) para
              ver os lotes.
            </p>
          ) : lotes.length === 0 ? (
            <p className="text-amber-800">
              Nenhum outro lote com saldo na cópia. Prepare a visita de novo com internet ou resolva
              o estoque na gestão antes de tentar.
            </p>
          ) : (
            <Select value={loteId} onValueChange={setLoteId}>
              <SelectTrigger aria-label="Lote">
                <SelectValue placeholder="Escolha o lote" />
              </SelectTrigger>
              <SelectContent>
                {lotes.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.lote} · vence {dataBR(l.validade)} · {l.saldo} dose(s)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            Voltar
          </Button>
          <Button
            disabled={!loteId || trabalhando}
            onClick={() => {
              setTrabalhando(true);
              void aoTrocar(trocarLote(operacao, loteId)).finally(() => setTrabalhando(false));
            }}
          >
            Usar este lote e tentar de novo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
