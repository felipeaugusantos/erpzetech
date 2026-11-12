import { useRef, useState } from "react";
import { FileUp, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { conferirPacienteLaudo, lerLaudoTexto, type LaudoPdf } from "@/lib/laudo-exame-pdf";
import { agruparLaudoImportacao, type GrupoImportacao, type ModeloImportacao } from "@/lib/laudo-importacao";
import { formatarNumero } from "@/lib/exames";
import { salvarPdfLaudo } from "@/lib/salvar-pdf-laudo";

export function ImportarExamesPetPdf({ pet, onImportado }: { pet: { id: string; nome: string; especie: string }; onImportado: (id: string | undefined) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const geracao = useRef(0);
  const anexos = useRef(new Map<string, { id: string; caminho: string; enviado: boolean; confirmado: boolean }>());
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [previa, setPrevia] = useState<{ laudo: LaudoPdf; grupos: GrupoImportacao[]; chave: string; arquivo: File } | null>(null);
  const [confirmado, setConfirmado] = useState(false);
  const [laboratorio, setLaboratorio] = useState("");
  const [coleta, setColeta] = useState("");
  async function ler(file: File) {
    const token = ++geracao.current;
    setOcupado(true); setPrevia(null); setConfirmado(false);
    try {
      if (!file.name.toLowerCase().endsWith(".pdf") || file.size > 10 * 1024 * 1024) throw new Error("Envie um PDF digital de até 10 MB.");
      const { textoDoPdf } = await import("@/lib/danfe-pdf");
      const laudo = lerLaudoTexto(await textoDoPdf(file));
      if (!conferirPacienteLaudo(laudo, pet)) throw new Error("O paciente ou a espécie do PDF não corresponde ao pet selecionado.");
      const { data, error } = await supabase.rpc("clinica_exame_modelos");
      if (error) throw error;
      const grupos = agruparLaudoImportacao(laudo, (data ?? []) as unknown as ModeloImportacao[]);
      if (token !== geracao.current) return;
      anexos.current.clear();
      setPrevia({ laudo, grupos, chave: crypto.randomUUID(), arquivo: file }); setColeta(laudo.coleta);
    } catch (e) { if (token === geracao.current) toast.error("Não foi possível ler o laudo", { description: e instanceof Error ? e.message : "Confira o PDF." }); }
    finally { if (token === geracao.current) setOcupado(false); }
  }
  async function importar() {
    if (!previa || !confirmado) return;
    setOcupado(true);
    let resultadosSalvos = false;
    try {
      const { data, error } = await supabase.rpc("clinica_importar_pdf", { p_pet_id: pet.id, p_chave: previa.chave, p_dados: { paciente: previa.laudo.paciente, especie: previa.laudo.especie, confirmado: true, laboratorio: laboratorio.trim(), coleta, grupos: previa.grupos } });
      if (error) throw error;
      const resultado = data as unknown as { exames: { id: string }[] };
      resultadosSalvos = true;
      for (const exame of resultado.exames) {
        await salvarPdfLaudo(exame.id, previa.arquivo, anexos.current);
      }
      toast.success(`${resultado.exames.length} exame(s) e PDF original salvos`);
      setAberto(false); setPrevia(null); onImportado(resultado.exames[0]?.id);
    } catch (e) { toast.error(resultadosSalvos ? "Resultados salvos; falta concluir o envio do PDF. Tente novamente nesta janela." : "Nenhum exame foi gravado", { description: e instanceof Error ? e.message : (e as { message?: string }).message ?? "Confira os campos e tente novamente." }); }
    finally { setOcupado(false); }
  }
  return <>
    <Button variant="outline" onClick={() => { setAberto(true); setPrevia(null); setConfirmado(false); setLaboratorio(""); }}><FileUp className="size-4" />Importar exame</Button>
    <Dialog open={aberto} onOpenChange={o => { if (ocupado) return; setAberto(o); if (!o) { geracao.current++; setPrevia(null); } }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Importar exames — {pet.nome}</DialogTitle></DialogHeader>
        <input ref={input} className="hidden" type="file" accept="application/pdf,.pdf" aria-label="PDF dos exames do animal" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void ler(f); }} />
        <Button variant="outline" disabled={ocupado} onClick={() => input.current?.click()}>{ocupado ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <FileUp className="size-4" />}{previa ? "Trocar PDF" : "Selecionar PDF"}</Button>
        {previa && <>
          <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="pdf-lab">Laboratório</Label><Input id="pdf-lab" value={laboratorio} maxLength={120} disabled={ocupado} onChange={e => { setLaboratorio(e.target.value); setConfirmado(false); }} /></div><div><Label htmlFor="pdf-coleta">Data da coleta</Label><Input id="pdf-coleta" type="date" value={coleta} disabled={ocupado} onChange={e => { setColeta(e.target.value); setConfirmado(false); }} /></div></div>
          {previa.grupos.map((g, gi) => <section key={gi} className="border-t pt-3">
            <h3 className="font-semibold">{g.nome} <span className="text-sm font-normal text-muted-foreground">· {g.modelo_id ? "Modelo existente; campos ausentes serão cadastrados" : "Novo modelo"}</span></h3>
            <div className="mt-2 grid gap-2">{g.itens.map((it, ii) => <div key={ii} className="grid items-center gap-2 border-b pb-2 sm:grid-cols-[1fr_6rem_8rem_1fr]">
              <span className="text-sm">{it.nome}</span><span className="text-sm font-medium">{formatarNumero(it.valor, null)}</span>
              <Input aria-label={`Unidade de ${it.nome}`} placeholder="Unidade" disabled={ocupado} value={it.unidade ?? ""} maxLength={30} onChange={e => { const grupos = previa.grupos.map((gr, j) => j === gi ? { ...gr, itens: gr.itens.map((item, k) => k === ii ? { ...item, unidade: e.target.value || null } : item) } : gr); setPrevia({ ...previa, grupos }); setConfirmado(false); }} />
              <span className="text-xs text-muted-foreground">{it.minimo !== null && it.maximo !== null ? `Ref. absoluta: ${formatarNumero(it.minimo, null)} a ${formatarNumero(it.maximo, null)}` : "Sem referência importada"}</span>
            </div>)}</div>
          </section>)}
          {previa.laudo.avisos.map(a => <p key={a} className="text-sm text-warning">{a}</p>)}
          <p className="text-sm text-muted-foreground">Referências absolutas apenas nos exames importados; faixas dos modelos e laudos anteriores permanecem iguais.</p>
          <label className="flex items-start gap-2 text-sm"><Checkbox disabled={ocupado} checked={confirmado} onCheckedChange={v => setConfirmado(v === true)} />Conferi paciente, espécie, coleta, resultados e unidades; autorizo criar os modelos e campos faltantes e salvar os exames em rascunho.</label>
          <div className="flex justify-end"><Button disabled={ocupado || !confirmado || !laboratorio.trim() || !coleta || previa.grupos.some(g => g.itens.some(i => i.minimo !== null && !i.unidade))} onClick={() => void importar()}>Importar todos os exames</Button></div>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}