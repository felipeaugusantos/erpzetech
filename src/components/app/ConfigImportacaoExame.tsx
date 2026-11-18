import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";

export type ModoImportacaoExame = "valores" | "arquivo";
export const SECOES_FICHA = [
  { id: "sinais", titulo: "Sinais vitais nas consultas" },
  { id: "documentos", titulo: "Receitas, atestados e pedidos de exame" },
  { id: "exames_agendados", titulo: "Exames agendados" },
  { id: "resumo_ia", titulo: "Resumo do histórico com IA" },
  { id: "favoritos", titulo: "Remédios favoritos da clínica" },
] as const;
export type SecaoFicha = (typeof SECOES_FICHA)[number]["id"];
export const chavePreferenciasClinica = ["clinica-preferencias"] as const;

export function usePreferenciasClinica(ativo = true) {
  return useQuery({
    queryKey: chavePreferenciasClinica,
    enabled: ativo,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_preferencias_ler");
      if (error) throw error;
      const d = data as {
        importacao_exame?: string;
        proxima_consulta?: boolean;
        secoes_ocultas?: string[];
      } | null;
      return {
        importacao_exame: (d?.importacao_exame === "arquivo"
          ? "arquivo"
          : "valores") as ModoImportacaoExame,
        proxima_consulta: d?.proxima_consulta !== false,
        secoes_ocultas: (d?.secoes_ocultas ?? []) as SecaoFicha[],
      };
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

const OPCOES: {
  valor: ModoImportacaoExame;
  titulo: string;
  texto: string;
  icone: typeof FileText;
}[] = [
  {
    valor: "valores",
    titulo: "Importar e preencher os valores",
    texto: "O sistema lê o PDF, preenche os resultados do exame e guarda o arquivo original.",
    icone: FlaskConical,
  },
  {
    valor: "arquivo",
    titulo: "Só guardar o arquivo no prontuário",
    texto: "O PDF fica no prontuário do paciente como laudo, sem lançar os valores.",
    icone: FileText,
  },
];

export function ConfigImportacaoExame() {
  const qc = useQueryClient();
  const { data } = usePreferenciasClinica();
  const salvar = useMutation({
    mutationFn: async (modo: ModoImportacaoExame) => {
      const { error } = await supabase.rpc("clinica_preferencias_salvar", {
        p_importacao_exame: modo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ajuste da clínica salvo");
      qc.invalidateQueries({ queryKey: chavePreferenciasClinica });
    },
    onError: (e) =>
      toast.error("Não foi possível salvar", {
        description: e instanceof Error ? e.message : (e as { message?: string }).message,
      }),
  });
  const atual = data?.importacao_exame ?? "valores";
  return (
    <div className="panel max-w-3xl space-y-3 p-5">
      <div>
        <p className="font-display text-sm font-semibold">Importação de exames em PDF</p>
        <p className="text-xs text-muted-foreground">
          Escolha o que acontece quando a clínica importa o laudo do laboratório.
        </p>
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
            <span className="flex items-center gap-2 font-semibold">
              <o.icone className="size-4" />
              {o.titulo}
            </span>
            <span className="text-xs font-normal opacity-80">{o.texto}</span>
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Só administrador e gestor alteram este ajuste.
      </p>
    </div>
  );
}

export function ConfigFichaProntuario() {
  const qc = useQueryClient();
  const { data } = usePreferenciasClinica();
  const salvar = useMutation({
    mutationFn: async (v: { proxima: boolean; ocultas: SecaoFicha[] }) => {
      const { error } = await supabase.rpc("clinica_preferencias_ficha_salvar", {
        p_proxima_consulta: v.proxima,
        p_secoes_ocultas: v.ocultas,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ficha do prontuário atualizada");
      void qc.invalidateQueries({ queryKey: chavePreferenciasClinica });
    },
    onError: (e) =>
      toast.error("Não foi possível salvar", {
        description: e instanceof Error ? e.message : (e as { message?: string }).message,
      }),
  });
  if (!data) return <div className="panel h-32 max-w-3xl animate-pulse" />;
  const ocultas = data.secoes_ocultas;
  return (
    <div className="panel max-w-3xl space-y-4 p-5">
      <div>
        <p className="font-display text-sm font-semibold">Ficha do prontuário</p>
        <p className="text-xs text-muted-foreground">
          Escolha o que aparece na ficha do paciente. O histórico de consultas sempre aparece.
        </p>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <Switch
          checked={data.proxima_consulta}
          disabled={salvar.isPending}
          onCheckedChange={(v) => salvar.mutate({ proxima: v, ocultas })}
        />
        <span>
          <span className="font-medium">Trabalhar com próxima consulta</span>
          <span className="block text-xs text-muted-foreground">
            Desligado, some o botão de agendar a próxima consulta no prontuário e no fechamento.
          </span>
        </span>
      </label>
      <div className="grid gap-2 border-t border-border pt-3">
        {SECOES_FICHA.map((s) => (
          <label key={s.id} className="flex items-center gap-3 text-sm">
            <Switch
              checked={!ocultas.includes(s.id)}
              disabled={salvar.isPending}
              onCheckedChange={(v) =>
                salvar.mutate({
                  proxima: data.proxima_consulta,
                  ocultas: v ? ocultas.filter((o) => o !== s.id) : [...ocultas, s.id],
                })
              }
            />
            {s.titulo}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Veterinário, administrador e gestor alteram este ajuste.
      </p>
    </div>
  );
}
