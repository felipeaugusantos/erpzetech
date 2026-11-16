import { useRef, useState } from "react";
import { FileUp, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  conferirPacienteLaudo,
  lerLaudoTexto,
  laboratorioDoLaudo,
  type LaudoPdf,
} from "@/lib/laudo-exame-pdf";
import {
  agruparLaudoImportacao,
  unidadesDivergentes,
  modelosPendentes,
  type GrupoImportacao,
  type ModeloImportacao,
} from "@/lib/laudo-importacao";
import { formatarNumero } from "@/lib/exames";
import { salvarPdfLaudo } from "@/lib/salvar-pdf-laudo";
import { usePreferenciasClinica } from "@/components/app/ConfigImportacaoExame";

export function ImportarExamesPetPdf({
  pet,
  onImportado,
}: {
  pet: { id: string; nome: string; especie: string };
  onImportado: (id: string | undefined) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const geracao = useRef(0);
  const anexos = useRef(
    new Map<string, { id: string; caminho: string; enviado: boolean; confirmado: boolean }>(),
  );
  const [aberto, setAberto] = useState(false);
  const { data: preferencias } = usePreferenciasClinica();
  const soArquivo = preferencias?.importacao_exame === "arquivo";
  const [ocupado, setOcupado] = useState(false);
  const [previa, setPrevia] = useState<{
    laudo: LaudoPdf;
    grupos: GrupoImportacao[];
    chave: string;
    arquivo: File;
    modelos: ModeloImportacao[];
  } | null>(null);
  const [confirmado, setConfirmado] = useState(false);
  const [laboratorio, setLaboratorio] = useState("");
  const [coleta, setColeta] = useState("");
  const [emissao, setEmissao] = useState("");
  const [referencia, setReferencia] = useState<"pdf" | "modelo">("pdf");
  async function ler(file: File) {
    const token = ++geracao.current;
    setOcupado(true);
    setPrevia(null);
    setConfirmado(false);
    setReferencia("pdf");
    try {
      if (!file.name.toLowerCase().endsWith(".pdf") || file.size > 10 * 1024 * 1024)
        throw new Error("Envie um PDF digital de até 10 MB.");
      const { textoDoPdf } = await import("@/lib/danfe-pdf");
      const textoPdf = await textoDoPdf(file);
      const laudo = lerLaudoTexto(textoPdf);
      if (!conferirPacienteLaudo(laudo, pet))
        throw new Error(
          `PDF: ${laudo.paciente} (${laudo.especie === "cao" ? "Cão" : laudo.especie === "gato" ? "Gato" : laudo.especie}). Paciente selecionado: ${pet.nome} (${pet.especie === "cao" ? "Cão" : pet.especie === "gato" ? "Gato" : pet.especie}). Abra os exames do paciente indicado no PDF para importar.`,
        );
      const { data, error } = await supabase.rpc("clinica_exame_modelos");
      if (error) throw error;
      const modelos = (data ?? []) as unknown as ModeloImportacao[];
      const grupos = agruparLaudoImportacao(laudo, modelos);
      if (token !== geracao.current) return;
      anexos.current.clear();
      setPrevia({ laudo, grupos, modelos, chave: crypto.randomUUID(), arquivo: file });
      setColeta(laudo.coleta);
      setEmissao(laudo.emissao ?? "");
      const lab = laboratorioDoLaudo(textoPdf);
      if (lab) setLaboratorio(lab);
    } catch (e) {
      if (token === geracao.current)
        toast.error("Não foi possível ler o laudo", {
          description: e instanceof Error ? e.message : "Confira o PDF.",
        });
    } finally {
      if (token === geracao.current) setOcupado(false);
    }
  }
  async function importar() {
    if (!previa || !confirmado || (!soArquivo && modelosPendentes(previa.grupos))) return;
    setOcupado(true);
    let resultadosSalvos = false;
    try {
      const { data, error } = soArquivo
        ? await supabase.rpc("clinica_importar_pdf_arquivo", {
            p_pet_id: pet.id,
            p_chave: previa.chave,
            p_dados: {
              paciente: previa.laudo.paciente,
              especie: previa.laudo.especie,
              confirmado: true,
              laboratorio: laboratorio.trim(),
              coleta,
              emissao,
            },
          })
        : await supabase.rpc("clinica_importar_pdf", {
            p_pet_id: pet.id,
            p_chave: previa.chave,
            p_dados: {
              paciente: previa.laudo.paciente,
              especie: previa.laudo.especie,
              confirmado: true,
              laboratorio: laboratorio.trim(),
              coleta,
              emissao,
              grupos:
                referencia === "pdf"
                  ? previa.grupos
                  : previa.grupos.map((g) => ({
                      ...g,
                      itens: g.itens.map((i) => ({ ...i, minimo: null, maximo: null })),
                    })),
            },
          });
      if (error) throw error;
      const resultado = data as unknown as { exames: { id: string }[] };
      resultadosSalvos = true;
      for (const exame of resultado.exames) {
        await salvarPdfLaudo(exame.id, previa.arquivo, anexos.current);
      }
      toast.success(
        soArquivo
          ? "PDF do laudo salvo no prontuário"
          : `${resultado.exames.length} exame(s) e PDF original salvos`,
      );
      setAberto(false);
      setPrevia(null);
      onImportado(resultado.exames[0]?.id);
    } catch (e) {
      toast.error(
        resultadosSalvos
          ? "Resultados salvos; falta concluir o envio do PDF. Tente novamente nesta janela."
          : "Nenhum exame foi gravado",
        {
          description:
            e instanceof Error
              ? e.message
              : ((e as { message?: string }).message ?? "Confira os campos e tente novamente."),
        },
      );
    } finally {
      setOcupado(false);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setAberto(true);
          setPrevia(null);
          setConfirmado(false);
          setLaboratorio("");
        }}
      >
        <FileUp className="size-4" />
        Importar exame
      </Button>
      <Dialog
        open={aberto}
        onOpenChange={(o) => {
          if (ocupado) return;
          setAberto(o);
          if (!o) {
            geracao.current++;
            setPrevia(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Importar exames — {pet.nome}</DialogTitle>
          </DialogHeader>
          <input
            ref={input}
            className="hidden"
            type="file"
            accept="application/pdf,.pdf"
            aria-label="PDF dos exames do animal"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void ler(f);
            }}
          />
          <Button variant="outline" disabled={ocupado} onClick={() => input.current?.click()}>
            {ocupado ? (
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <FileUp className="size-4" />
            )}
            {previa ? "Trocar PDF" : "Selecionar PDF"}
          </Button>
          {previa && (
            <>
              <p className="text-sm font-medium">
                Paciente no PDF: {previa.laudo.paciente} ·{" "}
                {previa.laudo.especie === "cao" ? "Cão" : "Gato"}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="pdf-lab">Laboratório</Label>
                  <Input
                    id="pdf-lab"
                    value={laboratorio}
                    maxLength={120}
                    disabled={ocupado}
                    onChange={(e) => {
                      setLaboratorio(e.target.value);
                      setConfirmado(false);
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="pdf-coleta">Data do exame (coleta ou atendimento)</Label>
                  <Input
                    id="pdf-coleta"
                    type="date"
                    value={coleta}
                    disabled={ocupado}
                    onChange={(e) => {
                      setColeta(e.target.value);
                      setConfirmado(false);
                    }}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="pdf-emissao">Data de emissão do laudo (se informada no PDF)</Label>
                <Input
                  id="pdf-emissao"
                  type="date"
                  value={emissao}
                  disabled={ocupado}
                  onChange={(e) => {
                    setEmissao(e.target.value);
                    setConfirmado(false);
                  }}
                />
              </div>
              {soArquivo && (
                <p className="rounded-md border bg-secondary/40 p-3 text-sm">
                  Ajuste da clínica: o PDF será guardado no prontuário como laudo, sem preencher os
                  valores. Para mudar, vá em Configurações › Clínica.
                </p>
              )}
              {!soArquivo &&
                previa.grupos.map((g, gi) => (
                  <section key={gi} className="border-t pt-3">
                    <h3 className="font-semibold">
                      {g.nome}{" "}
                      <span className="text-sm font-normal text-muted-foreground">
                        ·{" "}
                        {g.modelo_id
                          ? "Modelo existente; campos ausentes serão cadastrados"
                          : g.candidatos
                            ? "Escolha o modelo"
                            : "Novo modelo"}
                      </span>
                    </h3>
                    {g.candidatos && (
                      <div className="mt-2 grid gap-1">
                        <Label htmlFor={`pdf-modelo-${gi}`}>Modelo para {g.itens[0]?.nome}</Label>
                        <Select
                          disabled={ocupado}
                          value={g.modelo_id ?? ""}
                          onValueChange={(id) => {
                            const modelo = g.candidatos?.find((m) => m.id === id);
                            if (!modelo) return;
                            setPrevia({
                              ...previa,
                              grupos: previa.grupos.map((gr, i) =>
                                i === gi
                                  ? {
                                      ...gr,
                                      modelo_id: modelo.id,
                                      nome: modelo.nome,
                                      tipo: modelo.tipo,
                                    }
                                  : gr,
                              ),
                            });
                            setConfirmado(false);
                          }}
                        >
                          <SelectTrigger id={`pdf-modelo-${gi}`} className="w-full">
                            <SelectValue placeholder="Selecione o modelo" />
                          </SelectTrigger>
                          <SelectContent>
                            {g.candidatos.map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                {m.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="mt-2 grid gap-2">
                      {g.itens.map((it, ii) => (
                        <div
                          key={ii}
                          className="grid items-center gap-2 border-b pb-2 sm:grid-cols-[1fr_6rem_8rem_1fr]"
                        >
                          <span className="text-sm">{it.nome}</span>
                          <span className="text-sm font-medium">
                            {formatarNumero(it.valor, null)}
                          </span>
                          <Input
                            aria-label={`Unidade de ${it.nome}`}
                            placeholder="Unidade"
                            disabled={ocupado}
                            value={it.unidade ?? ""}
                            maxLength={30}
                            onChange={(e) => {
                              const grupos = previa.grupos.map((gr, j) =>
                                j === gi
                                  ? {
                                      ...gr,
                                      itens: gr.itens.map((item, k) =>
                                        k === ii
                                          ? { ...item, unidade: e.target.value || null }
                                          : item,
                                      ),
                                    }
                                  : gr,
                              );
                              setPrevia({ ...previa, grupos });
                              setConfirmado(false);
                            }}
                          />
                          <span className="text-xs text-muted-foreground">
                            {it.minimo !== null && it.maximo !== null
                              ? `Referência do PDF: ${formatarNumero(it.minimo, null)} a ${formatarNumero(it.maximo, null)}`
                              : "Sem referência importada"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              {!soArquivo && (
                <>
                  {previa.laudo.avisos.map((a) => (
                    <p key={a} className="text-sm text-warning">
                      {a}
                    </p>
                  ))}
                  <p className="text-sm text-muted-foreground">
                    Referências do PDF apenas nos exames importados; faixas dos modelos e laudos
                    anteriores permanecem iguais.
                  </p>
                  {unidadesDivergentes(previa.grupos, previa.modelos).length > 0 && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                      <p className="font-medium text-destructive">
                        Unidade diferente do modelo cadastrado
                      </p>
                      <p className="text-muted-foreground">
                        Ajuste a unidade abaixo para a do modelo, se for a mesma medida, ou corrija
                        o modelo antes de importar.
                      </p>
                      <ul className="mt-1 list-disc pl-5">
                        {unidadesDivergentes(previa.grupos, previa.modelos).map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <fieldset className="space-y-2 rounded-md border p-3">
                    <legend className="px-1 text-sm font-medium">
                      Qual referência usar nestes exames?
                    </legend>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={ocupado}
                        variant={referencia === "pdf" ? "default" : "outline"}
                        aria-pressed={referencia === "pdf"}
                        onClick={() => setReferencia("pdf")}
                      >
                        Do PDF do laboratório
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={ocupado}
                        variant={referencia === "modelo" ? "default" : "outline"}
                        aria-pressed={referencia === "modelo"}
                        onClick={() => setReferencia("modelo")}
                      >
                        Do modelo cadastrado
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {referencia === "pdf"
                        ? "Usa as faixas impressas no laudo; onde o PDF não traz faixa, vale a do modelo."
                        : "Ignora as faixas do PDF e usa as do modelo cadastrado na clínica."}
                    </p>
                  </fieldset>
                </>
              )}
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  disabled={ocupado}
                  checked={confirmado}
                  onCheckedChange={(v) => setConfirmado(v === true)}
                />
                {soArquivo
                  ? "Conferi paciente, espécie e data do exame; autorizo guardar este PDF no prontuário."
                  : "Conferi paciente, espécie, data do exame, resultados e unidades; autorizo criar os modelos e campos faltantes e salvar os exames em rascunho."}
              </label>
              <div className="flex justify-end">
                <Button
                  disabled={
                    ocupado ||
                    !confirmado ||
                    !laboratorio.trim() ||
                    !coleta ||
                    (!soArquivo &&
                      (modelosPendentes(previa.grupos) ||
                        unidadesDivergentes(previa.grupos, previa.modelos).length > 0 ||
                        (referencia === "pdf" &&
                          previa.grupos.some((g) =>
                            g.itens.some((i) => i.minimo !== null && !i.unidade),
                          ))))
                  }
                  onClick={() => void importar()}
                >
                  {soArquivo ? "Salvar PDF no prontuário" : "Importar todos os exames"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
