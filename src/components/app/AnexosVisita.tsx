import { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TIPO_ANEXO_ENVIAR,
  dadosDoAnexo,
  erroDoAnexoLocal,
  mensagemDeGravacao,
  operacaoDeAnexo,
  type AlvoAnexo,
} from "@/lib/anexo-offline";
import { CATEGORIAS_ANEXO, formatarTamanho, type CategoriaAnexo } from "@/lib/anexos";
import { PREFIXO_RASCUNHO, type RascunhoAtendimento } from "@/lib/atendimento-offline";
import type { Cofre } from "@/lib/cofre";
import { PREFIXO_EXAME, type RascunhoExame } from "@/lib/exame-offline";
import { situacaoNaFila, type OperacaoFila } from "@/lib/fila-clinica";
import { dateTimeBR } from "@/lib/format";

type Opcao = { valor: string; rotulo: string; alvo: AlvoAnexo; dependeDe: string };

/**
 * Anexo (foto ou PDF) de um atendimento ou exame feito neste notebook. O arquivo fica cifrado no cofre até haver internet; o envio é
 * da fila de pendências. Com internet, vai direto para a fila e sai em seguida.
 */
export function AnexosVisita({
  cofre,
  fila,
  online,
  enviando,
  aoGuardar,
}: {
  cofre: Cofre;
  fila: OperacaoFila[];
  online: boolean;
  /** Envio da fila em andamento: o que já saiu para o banco não se cancela daqui. */
  enviando: boolean;
  aoGuardar: () => Promise<void>;
}) {
  const [opcoes, setOpcoes] = useState<Opcao[]>([]);
  const [valor, setValor] = useState("");
  const [categoria, setCategoria] = useState<CategoriaAnexo>("imagem");
  const [descricao, setDescricao] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    const { itens } = await cofre.listar<unknown>("copia");
    const lista: Opcao[] = [];
    for (const [chave, v] of itens) {
      if (chave.startsWith(PREFIXO_RASCUNHO)) {
        const r = v as RascunhoAtendimento;
        lista.push({
          valor: `a:${r.atendimentoId}`,
          rotulo: `Atendimento de ${r.petNome} (tutor ${r.tutorNome}) · ${dateTimeBR(r.abertoEm)}`,
          alvo: { tipo: "atendimento", id: r.atendimentoId },
          dependeDe: r.registrarOpId,
        });
      } else if (chave.startsWith(PREFIXO_EXAME)) {
        const r = v as RascunhoExame;
        lista.push({
          valor: `e:${r.abrirOpId}`,
          rotulo: `Exame ${r.modelo.nome} de ${r.petNome} (tutor ${r.tutorNome}) · ${dateTimeBR(r.criadoEm)}`,
          alvo: { tipo: "exame", abrirOpId: r.abrirOpId },
          dependeDe: r.abrirOpId,
        });
      }
    }
    setOpcoes(lista.sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR")));
  }, [cofre]);

  useEffect(() => {
    void carregar().catch((e: Error) =>
      toast.error("Não foi possível ler os registros do cofre", { description: e.message }),
    );
  }, [carregar, fila]);

  const escolhida = opcoes.find((o) => o.valor === valor) ?? null;
  const pendentes = fila.filter((op) => op.tipo === TIPO_ANEXO_ENVIAR);

  async function guardar() {
    if (!escolhida || !arquivo) return;
    if (!descricao.trim()) {
      toast.error('Descreva o anexo (por exemplo, "Ultrassom abdominal")');
      return;
    }
    setGuardando(true);
    try {
      const estimativa = await navigator.storage?.estimate?.().catch(() => null);
      const erro = erroDoAnexoLocal(arquivo, { fila, alvo: escolhida.alvo, estimativa });
      if (erro) {
        toast.error("Não foi possível guardar o anexo", { description: erro });
        return;
      }
      // pede ao navegador para não apagar o cofre por falta de espaço (ele pode negar; o aviso de espaço acima já protege o caso comum)
      void navigator.storage?.persist?.().catch(() => false);
      const bytes = await arquivo.arrayBuffer();
      const op = operacaoDeAnexo(
        escolhida.alvo,
        { categoria, descricao, arquivo, dependeDe: [escolhida.dependeDe] },
        escolhida.rotulo,
      );
      // primeiro o arquivo, depois a operação: se cair no meio, sobra um arquivo sem operação (que o cofre ignora) e nunca o contrário
      await cofre.gravarArquivo(op.id, bytes);
      try {
        await cofre.gravar("fila", op.id, op);
      } catch (e) {
        await cofre.apagarArquivo(op.id).catch(() => undefined);
        throw e;
      }
      await aoGuardar();
      setDescricao("");
      setArquivo(null);
      if (entrada.current) entrada.current.value = "";
      toast.success(online ? "Anexo guardado: segue para o envio" : "Anexo guardado no cofre");
    } catch (e) {
      toast.error("Não foi possível guardar o anexo", { description: mensagemDeGravacao(e) });
    } finally {
      setGuardando(false);
    }
  }

  async function remover(op: OperacaoFila) {
    if (enviando) return;
    try {
      await cofre.apagar("fila", op.id);
      await cofre.apagarArquivo(op.id);
      await aoGuardar();
      toast.success("Anexo removido do cofre");
    } catch (e) {
      toast.error("Não foi possível remover", { description: (e as Error).message });
    }
  }

  return (
    <div className="panel grid gap-3 p-4">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <Paperclip className="size-5" /> Anexos da visita
      </h2>
      <p className="text-sm text-muted-foreground">
        Foto ou PDF (JPEG, PNG, PDF, até 15 MB) de um atendimento ou exame feito neste notebook. O
        arquivo fica cifrado no cofre até o envio.
      </p>
      {opcoes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Abra um atendimento ou um exame neste notebook para anexar arquivos a ele.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="an-alvo">Anexar a</Label>
            <Select value={valor} onValueChange={setValor}>
              <SelectTrigger id="an-alvo">
                <SelectValue placeholder="Escolha o atendimento ou exame" />
              </SelectTrigger>
              <SelectContent>
                {opcoes.map((o) => (
                  <SelectItem key={o.valor} value={o.valor}>
                    {o.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="an-cat">Tipo</Label>
            <Select value={categoria} onValueChange={(v) => setCategoria(v as CategoriaAnexo)}>
              <SelectTrigger id="an-cat">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIAS_ANEXO.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="an-desc">Descrição</Label>
            <Input
              id="an-desc"
              value={descricao}
              maxLength={200}
              placeholder="Ultrassom abdominal"
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="an-arq">Arquivo</Label>
            <Input
              id="an-arq"
              ref={entrada}
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="sm:col-span-2">
            <Button onClick={() => void guardar()} disabled={!escolhida || !arquivo || guardando}>
              {guardando ? "Guardando…" : "Guardar anexo"}
            </Button>
          </div>
        </div>
      )}

      {pendentes.length > 0 && (
        <div className="grid gap-2">
          <p className="text-sm font-medium">Esperando envio</p>
          <ul className="grid gap-2 text-sm">
            {pendentes.map((op) => {
              const d = dadosDoAnexo(op);
              const s = situacaoNaFila(op, fila);
              return (
                <li
                  key={op.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                >
                  <span>
                    <strong>{d.descricao}</strong> · {d.nome_arquivo} · {formatarTamanho(d.tamanho)}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge variant={s === "recusada" ? "destructive" : "outline"}>
                      {s === "recusada" ? "Recusado" : s === "pronta" ? "Pronto" : "Aguardando"}
                    </Badge>
                    {s !== "recusada" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={enviando}
                        title={enviando ? "Aguarde o envio terminar" : undefined}
                        aria-label={`Remover ${d.nome_arquivo}`}
                        onClick={() => void remover(op)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            Anexo recusado pelo banco aparece em “Pendências de envio”, com o motivo.
          </p>
        </div>
      )}
    </div>
  );
}
