import { useEffect, useRef, useState } from "react";
import { Mic, Square, FileText, LoaderCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { recordWav } from "@/lib/record-wav";
import { CAMPOS_AUDIO, lerTranscricao, type CampoAudio } from "@/lib/consulta-audio";

export function AudioConsulta({ atendimento, agendamento, onConfirmar }: {
  atendimento: string; agendamento: string;
  onConfirmar: (campo: CampoAudio, texto: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [consentimento, setConsentimento] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [file, setFile] = useState<File>();
  const [audioUrl, setAudioUrl] = useState("");
  const [texto, setTexto] = useState("");
  const [completo, setCompleto] = useState(false);
  const [campo, setCampo] = useState<CampoAudio>("anamnese");
  const [erro, setErro] = useState("");
  const recorder = useRef<Awaited<ReturnType<typeof recordWav>>>();
  const abort = useRef<AbortController>();
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => {
    vivo.current = false; abort.current?.abort();
    void recorder.current?.stop().catch(() => {}); recorder.current = undefined;
  }; }, []);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file); setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (!gravando) return;
    const timer = window.setInterval(() => setSegundos(s => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [gravando]);
  async function parar() {
    const atual = recorder.current;
    if (!atual) return;
    recorder.current = undefined; setGravando(false);
    try { const arquivo = await atual.stop(); if (vivo.current) setFile(arquivo); }
    catch { if (vivo.current) setErro("Áudio vazio. Grave novamente."); }
  }
  async function iniciar() {
    setErro(""); setOcupado(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microfone indisponível neste navegador.");
      const novo = await recordWav(() => { void parar(); });
      if (!vivo.current) { await novo.stop(); return; }
      recorder.current = novo; setFile(undefined); setTexto(""); setCompleto(false); setSegundos(0); setGravando(true);
    } catch { if (vivo.current) setErro("Não foi possível acessar o microfone. Confira a permissão do navegador."); }
    finally { if (vivo.current) setOcupado(false); }
  }
  async function transcrever() {
    if (!file) return;
    setOcupado(true); setErro(""); setCompleto(false); setTexto("");
    const controller = new AbortController(); abort.current = controller;
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("Entre na sua conta para transcrever.");
      const body = new FormData();
      body.set("file", file); body.set("atendimento", atendimento); body.set("agendamento", agendamento); body.set("consentimento", String(consentimento));
      const response = await fetch("/api/clinica/transcrever", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body, signal: controller.signal });
      await lerTranscricao(response, t => { if (vivo.current) setTexto(t); });
      if (vivo.current) setCompleto(true);
    } catch (e) { if (vivo.current) setErro(e instanceof Error ? e.message : "Não foi possível transcrever."); }
    finally { if (vivo.current) setOcupado(false); }
  }
  async function confirmar() {
    setOcupado(true); setErro("");
    try {
      await onConfirmar(campo, texto);
      if (vivo.current) { setOpen(false); setFile(undefined); setTexto(""); setCompleto(false); }
    } catch (e) { if (vivo.current) setErro(e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { if (vivo.current) setOcupado(false); }
  }
  return <>
    <Button variant="outline" onClick={() => setOpen(true)}><Mic className="size-4" />Gravar áudio</Button>
    <Dialog open={open} onOpenChange={o => { if (!gravando && !ocupado) setOpen(o); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" onInteractOutside={e => { if (gravando || ocupado) e.preventDefault(); }}>
        <DialogHeader><DialogTitle>Áudio da consulta</DialogTitle><DialogDescription>Rascunho para revisão veterinária. O áudio não fica salvo no sistema.</DialogDescription></DialogHeader>
        <label className="flex items-start gap-2 text-sm"><Checkbox checked={consentimento} disabled={gravando || ocupado} onCheckedChange={v => setConsentimento(v === true)} />Autorizo o envio para transcrição e, se houver fala do tutor, obtive seu consentimento.</label>
        <div className="flex flex-wrap items-center gap-3">
          {gravando ? <Button variant="destructive" onClick={() => void parar()}><Square className="size-4" />Parar gravação</Button> : <Button onClick={() => void iniciar()} disabled={!consentimento || ocupado || Boolean(file)}><Mic className="size-4" />Iniciar gravação</Button>}
          <span className="text-sm tabular-nums" role="status">{String(Math.floor(segundos / 60)).padStart(2, "0")}:{String(segundos % 60).padStart(2, "0")} / 02:00</span>
        </div>
        {file && <div className="space-y-3"><audio controls src={audioUrl} className="w-full" aria-label="Áudio gravado" />
          <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={ocupado || completo || !consentimento} onClick={() => void transcrever()}>{ocupado ? <LoaderCircle className="size-4 animate-spin" /> : <FileText className="size-4" />}Transcrever</Button>
            <Button variant="ghost" disabled={ocupado} onClick={() => { setFile(undefined); setTexto(""); setCompleto(false); }}><Trash2 className="size-4" />Descartar áudio</Button></div></div>}
        {texto && <div className="space-y-3"><Label htmlFor="audio-campo">Adicionar ao campo</Label><Select value={campo} disabled={ocupado} onValueChange={v => setCampo(v as CampoAudio)}><SelectTrigger id="audio-campo"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(CAMPOS_AUDIO).map(([id, nome]) => <SelectItem key={id} value={id}>{nome}</SelectItem>)}</SelectContent></Select>
          <Label htmlFor="audio-texto">Transcrição — revise antes de confirmar</Label><Textarea id="audio-texto" value={texto} onChange={e => setTexto(e.target.value)} disabled={ocupado} rows={7} maxLength={8000} />
          <Button disabled={!completo || ocupado || !texto.trim()} onClick={() => void confirmar()}>Confirmar e salvar na ficha</Button></div>}
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
      </DialogContent>
    </Dialog>
  </>;
}