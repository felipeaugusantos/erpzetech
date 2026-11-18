import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Send } from "lucide-react";
import { toast } from "sonner";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { whatsappTeste } from "@/lib/whatsapp-teste.functions";
import { entradaTesteWhatsApp } from "@/lib/whatsapp-teste";
import { dateTimeBR } from "@/lib/format";

const ROTULOS: Record<string, string> = {
  enviando: "Envio em andamento — confira antes de repetir",
  enviada: "Serviço aceitou — entrega ainda não confirmada",
  entregue: "Entrega confirmada",
  lida: "Lida",
  falhou: "Falhou",
  incerto: "Envio incerto — confira o celular antes de repetir",
};

export function TesteWhatsAppClinica({ conectado }: { conectado: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState({
    numero: "",
    modelo: "vacina_antes" as "vacina_antes" | "vacina_atrasada" | "consulta_antes",
    tutor: "",
    pet: "",
    data: "",
    itens: "",
  });
  const [previa, setPrevia] = useState<{ texto: string; id: string } | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const chamar = useServerFn(whatsappTeste);
  const qc = useQueryClient();
  const testes = useQuery({
    queryKey: ["clinica-wa-testes"],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinica_wa_testes")
        .select("id,numero,modelo,situacao,erro,created_at")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });
  const meuTelefone = useQuery({
    queryKey: ["meu-telefone-teste-wa"],
    queryFn: async () => {
      const { data: u, error: eu } = await supabase.auth.getUser();
      if (eu || !u.user) throw eu ?? new Error("Sessão expirada");
      const { data, error } = await supabase
        .from("profiles")
        .select("telefone")
        .eq("id", u.user.id)
        .maybeSingle();
      if (error) throw error;
      return data?.telefone ?? "";
    },
  });
  useEffect(() => {
    if (meuTelefone.data !== undefined) setDados((d) => ({ ...d, numero: meuTelefone.data }));
  }, [meuTelefone.data]);
  const preparar = useMutation({
    mutationFn: () => chamar({ data: { dados } }),
    onSuccess: (r) => {
      setPrevia({ texto: r.texto, id: crypto.randomUUID() });
      setResultado(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const enviar = useMutation({
    mutationFn: () => {
      if (!previa) throw new Error("Confira a mensagem antes de enviar.");
      return chamar({ data: { dados, envio: { id: previa.id, textoConfirmado: previa.texto } } });
    },
    onSuccess: (r) => {
      setResultado(r.situacao);
      void qc.invalidateQueries({ queryKey: ["clinica-wa-testes"] });
    },
    onError: (e: Error) => {
      setResultado("incerto");
      toast.error(e.message);
      void qc.invalidateQueries({ queryKey: ["clinica-wa-testes"] });
    },
  });
  const mudar = (campo: keyof typeof dados, valor: string) => {
    setDados((d) => ({ ...d, [campo]: valor }));
    setPrevia(null);
    setResultado(null);
  };
  return (
    <section className="mb-6 max-w-2xl space-y-3 border-y border-border py-4">
      <Button variant="outline" onClick={() => setAberto(true)}>
        <FlaskConical className="size-4" /> Testar mensagem
      </Button>
      {testes.error && (
        <p className="text-sm text-destructive">Não foi possível consultar os testes.</p>
      )}
      {(testes.data?.length ?? 0) > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Últimos testes</h3>
          <ul className="space-y-2 text-sm">
            {testes.data?.map((t) => (
              <li key={t.id} className="min-w-0 border-b border-border pb-2">
                <p>
                  {t.numero} · {dateTimeBR(t.created_at)}
                </p>
                <p className="text-muted-foreground">{ROTULOS[t.situacao] ?? t.situacao}</p>
                {t.erro && <p className="break-words text-destructive">{t.erro}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Dialog
        open={aberto}
        onOpenChange={(v) => {
          if (!enviar.isPending) setAberto(v);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Testar mensagem da clínica</DialogTitle>
          </DialogHeader>
          <div className="grid min-w-0 gap-3">
            {!conectado && (
              <p className="text-sm text-destructive">
                Conecte o WhatsApp da clínica antes de enviar o teste.
              </p>
            )}
            <div>
              <Label htmlFor="teste-numero">Seu telefone cadastrado</Label>
              <Input id="teste-numero" type="tel" value={dados.numero} readOnly disabled />
              <p className="mt-1 text-xs text-muted-foreground">
                {meuTelefone.isSuccess && !dados.numero
                  ? "Cadastre o seu telefone no seu usuário para receber o teste."
                  : "O teste é enviado somente para o seu próprio telefone cadastrado."}
              </p>
            </div>
            <div>
              <Label htmlFor="teste-modelo">Lembrete</Label>
              <Select
                value={dados.modelo}
                disabled={enviar.isPending}
                onValueChange={(v) => mudar("modelo", v)}
              >
                <SelectTrigger id="teste-modelo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vacina_antes">Vacina: dias antes</SelectItem>
                  <SelectItem value="vacina_atrasada">Vacina: dias após vencer</SelectItem>
                  <SelectItem value="consulta_antes">Retorno: dias antes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="teste-tutor">Nome do tutor</Label>
                <Input
                  id="teste-tutor"
                  value={dados.tutor}
                  disabled={enviar.isPending}
                  onChange={(e) => mudar("tutor", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="teste-pet">Nome do paciente</Label>
                <Input
                  id="teste-pet"
                  value={dados.pet}
                  disabled={enviar.isPending}
                  onChange={(e) => mudar("pet", e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="teste-data">Data do lembrete</Label>
              <Input
                id="teste-data"
                type="date"
                value={dados.data}
                disabled={enviar.isPending}
                onChange={(e) => mudar("data", e.target.value)}
              />
            </div>
            {dados.modelo !== "consulta_antes" && (
              <div>
                <Label htmlFor="teste-itens">Vacina ou dose</Label>
                <Input
                  id="teste-itens"
                  value={dados.itens}
                  disabled={enviar.isPending}
                  onChange={(e) => mudar("itens", e.target.value)}
                />
              </div>
            )}
            <Button
              variant="outline"
              disabled={
                !conectado ||
                !entradaTesteWhatsApp.safeParse(dados).success ||
                preparar.isPending ||
                enviar.isPending
              }
              onClick={() => preparar.mutate()}
            >
              {preparar.isPending ? "Carregando…" : "Conferir mensagem"}
            </Button>
            {previa && (
              <>
                <p className="whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-3 text-sm">
                  {previa.texto}
                </p>
                <p className="text-sm text-destructive">
                  Uma mensagem real será enviada para {dados.numero}.
                </p>
                <Button
                  disabled={enviar.isPending || !!resultado || !conectado}
                  onClick={() => enviar.mutate()}
                >
                  <Send className="size-4" />{" "}
                  {enviar.isPending ? "Enviando…" : "Confirmar e enviar teste"}
                </Button>
              </>
            )}
            {resultado && (
              <p role="status" className="text-sm">
                {ROTULOS[resultado] ?? resultado}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
