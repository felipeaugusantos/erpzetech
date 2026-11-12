import { useEffect, useRef, useState } from "react";
import { Contact, FileText, LoaderCircle, MapPin } from "lucide-react";
import { aplicarEnderecoCep, consultarCep, normalizarCep } from "@/lib/cep";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DadosTutor } from "@/lib/tutor-novo";

type Props = {
  dados: DadosTutor;
  telefone: string;
  onChange: (dados: DadosTutor) => void;
  onTelefone: (valor: string) => void;
};

export function DadosCadastroTutor({ dados, telefone, onChange, onTelefone }: Props) {
  const atuais = useRef({ dados, onChange });
  atuais.current = { dados, onChange };
  const [situacaoCep, setSituacaoCep] = useState<{ carregando: boolean; mensagem: string; erro: boolean }>({ carregando: false, mensagem: "", erro: false });
  const cep = normalizarCep(dados.cep);
  useEffect(() => {
    setSituacaoCep({ carregando: false, mensagem: "", erro: false });
    if (cep.length !== 8) return;
    const controle = new AbortController();
    const tempo = setTimeout(async () => {
      const inicio = { ...atuais.current.dados };
      setSituacaoCep({ carregando: true, mensagem: "Buscando endereço…", erro: false });
      try {
        const encontrado = await consultarCep(cep, controle.signal);
        if (controle.signal.aborted || normalizarCep(atuais.current.dados.cep) !== cep) return;
        atuais.current.onChange(aplicarEnderecoCep(atuais.current.dados, inicio, encontrado));
        setSituacaoCep({ carregando: false, mensagem: encontrado.endereco ? "Endereço encontrado." : "Cidade e UF encontradas. Informe a rua e o bairro.", erro: false });
      } catch {
        if (controle.signal.aborted) return;
        setSituacaoCep({ carregando: false, mensagem: "CEP não encontrado ou consulta indisponível. Confira o CEP ou preencha manualmente.", erro: true });
      }
    }, 400);
    return () => { clearTimeout(tempo); controle.abort(); };
  }, [cep]);
  const campo = (chave: keyof DadosTutor, titulo: string, classe = "", tipo = "text") => (
    <div className={classe}>
      <Label htmlFor={`tutor-${chave}`} className="text-xs">{titulo}</Label>
      <Input id={`tutor-${chave}`} type={tipo} value={dados[chave] ?? ""}
        {...(chave === "cep" ? { mascara: "cep" as const } : {})}
        {...(chave === "documento" ? { mascara: "cpfcnpj" as const } : {})}
        {...(chave === "whatsapp" ? { mascara: "telefone" as const } : {})}
        maxLength={chave === "estado" ? 2 : 160}
        {...(chave === "cep" ? { inputMode: "numeric" as const, "aria-describedby": "tutor-cep-status" } : {})}
        onChange={(e) => onChange({ ...dados, [chave]: chave === "estado" ? e.target.value.toUpperCase() : e.target.value })} />
    </div>
  );
  return (
    <Tabs defaultValue="contatos" className="sm:col-span-2">
      <TabsList className="mb-3 grid h-auto w-full grid-cols-3 rounded-md">
        <TabsTrigger value="contatos" className="gap-1.5 whitespace-normal px-2 py-2 text-xs"><MapPin className="size-4 shrink-0" />Endereço e contatos</TabsTrigger>
        <TabsTrigger value="documentos" className="gap-1.5 px-2 py-2 text-xs"><Contact className="size-4 shrink-0" />Documentos</TabsTrigger>
        <TabsTrigger value="observacoes" className="gap-1.5 px-2 py-2 text-xs"><FileText className="size-4 shrink-0" />Observações</TabsTrigger>
      </TabsList>
      <TabsContent value="contatos" forceMount className="data-[state=inactive]:hidden">
        <div className="grid gap-3 sm:grid-cols-6">
          {campo("nome_fantasia", "Nome fantasia / apelido", "sm:col-span-6")}
          {campo("cep", "CEP", "sm:col-span-2")}
          <div id="tutor-cep-status" role="status" aria-live="polite" className={`flex items-center gap-2 text-xs sm:col-span-4 ${situacaoCep.erro ? "text-destructive" : "text-muted-foreground"}`}>
            {situacaoCep.carregando && <LoaderCircle className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />}{situacaoCep.mensagem}
          </div>
          {campo("endereco", "Rua / avenida", "sm:col-span-4")}
          {campo("numero", "Número", "sm:col-span-2")}
          {campo("bairro", "Bairro", "sm:col-span-3")}
          {campo("cidade", "Cidade", "sm:col-span-3")}
          {campo("estado", "UF", "sm:col-span-1")}
          {campo("complemento", "Complemento", "sm:col-span-5")}
          <div className="sm:col-span-3"><Label htmlFor="tutor-fone" className="text-xs">Telefone (com DDD)</Label>
            <Input id="tutor-fone" mascara="telefone" value={telefone} maxLength={30} onChange={(e) => onTelefone(e.target.value)} /></div>
          {campo("whatsapp", "WhatsApp", "sm:col-span-3")}
          {campo("email", "E-mail", "sm:col-span-6", "email")}
        </div>
      </TabsContent>
      <TabsContent value="documentos" forceMount className="data-[state=inactive]:hidden">
        <div className="grid gap-3 sm:grid-cols-2">
          {campo("documento", "CPF ou CNPJ")}
          {campo("inscricao_estadual", "Inscrição estadual")}
        </div>
      </TabsContent>
      <TabsContent value="observacoes" forceMount className="data-[state=inactive]:hidden">
        <Label htmlFor="tutor-observacoes">Observações gerais</Label>
        <Textarea id="tutor-observacoes" rows={5} value={dados.observacoes ?? ""} maxLength={4000}
          onChange={(e) => onChange({ ...dados, observacoes: e.target.value })} />
      </TabsContent>
    </Tabs>
  );
}