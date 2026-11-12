import { useEffect, useRef, useState } from "react";
import { FileUp, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { conferirPacienteLaudo, corresponderLaudo, lerLaudoTexto, type LaudoPdf, type CorrespondenciaLaudo } from "@/lib/laudo-exame-pdf";
import type { ExameClinico } from "@/lib/exames";

export function ImportarLaudoPdf({ exame, disabled, solicitacao = 0, onAplicar }: { exame: ExameClinico; disabled: boolean; solicitacao?: number; onAplicar: (linhas: CorrespondenciaLaudo[], laudo: LaudoPdf) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [escolherArquivo, setEscolherArquivo] = useState(false);
  useEffect(() => { if (solicitacao > 0) setEscolherArquivo(true); }, [solicitacao]);
  const [lendo, setLendo] = useState(false);
  const [previa, setPrevia] = useState<{ laudo: LaudoPdf; linhas: CorrespondenciaLaudo[] } | null>(null);
  const [confirmado, setConfirmado] = useState(false);
  async function ler(file: File) {
    setEscolherArquivo(false);
    setLendo(true);
    setPrevia(null);
    setConfirmado(false);
    try {
      if (!file.name.toLowerCase().endsWith(".pdf") || file.size > 10 * 1024 * 1024) throw new Error("Envie um PDF digital de até 10 MB.");
      const { textoDoPdf } = await import("@/lib/danfe-pdf");
      const texto = await textoDoPdf(file).catch(() => { throw new Error("Não foi possível ler o PDF. Envie o laudo digital, não uma foto ou digitalização."); });
      const laudo = lerLaudoTexto(texto);
      if (!conferirPacienteLaudo(laudo, exame.pet)) throw new Error(`O laudo é de ${laudo.paciente}, ${laudo.especie === "gato" ? "gato" : "cão"}. Abra o exame do paciente correto.`);
      const linhas = corresponderLaudo(laudo, exame.resultados);
      if (!linhas.length) throw new Error("Nenhum campo com nome e unidade compatíveis neste exame. Confira o modelo selecionado.");
      setPrevia({ laudo, linhas });
    } catch (e) { toast.error("Não foi possível importar", { description: e instanceof Error ? e.message : "Confira o arquivo." }); }
    finally { setLendo(false); }
  }
  return <>
    <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" aria-label="Arquivo do laudo PDF"
      onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void ler(file); }} />
    <Button variant="outline" disabled={disabled || lendo} onClick={() => input.current?.click()}>
      {lendo ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <FileUp className="size-4" />}Importar laudo PDF
    </Button>
    <Dialog open={escolherArquivo} onOpenChange={setEscolherArquivo}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Importar exame — {exame.pet.nome}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{exame.nome}</p>
        <Button variant="outline" disabled={disabled || lendo} onClick={() => input.current?.click()}><FileUp className="size-4" />Selecionar laudo PDF</Button>
      </DialogContent>
    </Dialog>
    <Dialog open={previa !== null} onOpenChange={o => { if (!o) setPrevia(null); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Conferir laudo — {previa?.laudo.paciente}</DialogTitle></DialogHeader>
        {previa && <>
          <p className="text-sm">{previa.laudo.especie === "gato" ? "Gato" : "Cão"} · Coleta {previa.laudo.coleta.split("-").reverse().join("/") || "não identificada"} · {previa.linhas.length} campos compatíveis</p>
          <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Campo</TableHead><TableHead>Resultado</TableHead><TableHead>Referência absoluta</TableHead></TableRow></TableHeader><TableBody>
            {previa.linhas.map(({ campo, item }) => <TableRow key={campo.id}><TableCell>{campo.nome}</TableCell><TableCell>{item.valor.toLocaleString("pt-BR")} {campo.unidade}</TableCell><TableCell>{item.minimo !== null ? `${item.minimo.toLocaleString("pt-BR")} a ${item.maximo?.toLocaleString("pt-BR")}` : "Mantém a atual"}</TableCell></TableRow>)}
          </TableBody></Table></div>
          {previa.laudo.avisos.map(a => <p key={a} className="text-sm text-warning">{a}</p>)}
          {previa.linhas.length < previa.laudo.itens.length && <p className="text-sm text-muted-foreground">{previa.laudo.itens.length - previa.linhas.length} campos de outros modelos, incompatíveis ou ambíguos não serão preenchidos.</p>}
          <p className="text-sm text-muted-foreground">As referências absolutas valem apenas para este exame. As relativas e as do modelo não serão alteradas.</p>
          <label className="flex items-start gap-2 text-sm"><Checkbox checked={confirmado} onCheckedChange={v => setConfirmado(v === true)} />Conferi o paciente, a espécie, a data, os valores e as unidades; autorizo substituir os campos listados no rascunho.</label>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setPrevia(null)}>Cancelar</Button><Button disabled={!confirmado} onClick={() => { onAplicar(previa.linhas, previa.laudo); setPrevia(null); }}>Preencher exame</Button></div>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}