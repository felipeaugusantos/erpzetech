import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export type ModoImportacaoExame = "valores" | "arquivo";
export const chavePreferenciasClinica = ["clinica-preferencias"] as const;

export function usePreferenciasClinica(ativo = true) {
  return useQuery({
    queryKey: chavePreferenciasClinica,
    enabled: ativo,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_preferencias_ler");
      if (error) throw error;
      const modo = (data as { importacao_exame?: string } | null)?.importacao_exame;
      return { importacao_exame: (modo === "arquivo" ? "arquivo" : "valores") as ModoImportacaoExame };
    },
  });
}

export function useClinicaLiberada() {
  return useQuery({
    queryKey: ["clinica-liberada"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_liberada");
      if (error) return false;
      return data === true;
    },
  });
}

const OPCOES: { valor: ModoImportacaoExame; titulo: string; texto: string; icone: typeof FileText }[] = [
  { valor: "valores", titulo: "Importar e preencher os valores", texto: "O sistema lê o PDF, preenche os resultados do exame e guarda o arquivo original.", icone: FlaskConical },
  { valor: "arquivo", titulo: "Só guardar o arquivo no prontuário", texto: "O PDF fica no prontuário do paciente como laudo, sem lançar os valores.", icone: FileText },
];

export function ConfigImportacaoExame() {
  const qc = useQueryClient();
  const { data } = usePreferenciasClinica();
  const salvar = useMutation({
    mutationFn: async (modo: ModoImportacaoExame) => {
      const { error } = await supabase.rpc("clinica_preferencias_salvar", { p_importacao_exame: modo });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ajuste da clínica salvo");
      qc.invalidateQueries({ queryKey: chavePreferenciasClinica });
    },
    onError: (e) => toast.error("Não foi possível salvar", { description: e instanceof Error ? e.message : (e as { message?: string }).message }),
  });
  const atual = data?.importacao_exame ?? "valores";
  return (
    <div className="panel max-w-3xl space-y-3 p-5">
      <div>
        <p className="font-display text-sm font-semibold">Importação de exames em PDF</p>
        <p className="text-xs text-muted-foreground">Escolha o que acontece quando a clínica importa o laudo do laboratório.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {OPCOES.map((o) => (
          <Button
            key={o.valor}
            type="button"
            variant={atual === o.valor ? "default" : "outline"}
            aria-pressed={atual === o.valor}
            disabled={salvar.isPending}
            className="h-auto flex-col items-start gap-1 whitespace-normal p-3 text-left"
            onClick={() => atual !== o.valor && salvar.mutate(o.valor)}
          >
            <span className="flex items-center gap-2 font-semibold"><o.icone className="size-4" />{o.titulo}</span>
            <span className="text-xs font-normal opacity-80">{o.texto}</span>
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Só administrador e gestor alteram este ajuste.</p>
    </div>
  );
}
