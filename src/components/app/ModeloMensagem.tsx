import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { useModeloMensagem } from "@/hooks/useModeloMensagem";
import { CAMPOS_MENSAGEM, type TipoMensagem } from "@/lib/contato-pet";

/**
 * Editor da mensagem de WhatsApp. Qualquer um ajusta o texto para o envio de agora; administrador e gestor
 * guardam o modelo da empresa (vale para todos, em qualquer aparelho) ou voltam ao padrão.
 */
export function ModeloMensagem({
  tipo,
  id,
  valor,
  onChange,
}: {
  tipo: TipoMensagem;
  id: string;
  valor: string;
  onChange: (v: string) => void;
}) {
  const qc = useQueryClient();
  const { data: sessao } = useSessionData();
  const podeGuardar = (sessao?.roles ?? []).some((r) => r === "administrador" || r === "gestor");
  const { salvo, padrao, carregando } = useModeloMensagem(tipo);
  const base = salvo ?? padrao;
  const [iniciado, setIniciado] = useState<TipoMensagem | null>(null);

  // Ao abrir (ou trocar de tipo) mostra o modelo da empresa assim que ele chega.
  useEffect(() => {
    if (carregando || iniciado === tipo) return;
    setIniciado(tipo);
    onChange(base);
  }, [carregando, iniciado, tipo, base, onChange]);

  const guardar = useMutation({
    mutationFn: async (texto: string) => {
      const { error } = await supabase.rpc("pet_mensagem_modelo_salvar", {
        p_tipo: tipo,
        p_texto: texto,
      });
      if (error) throw error;
    },
    onSuccess: (_d, texto) => {
      void qc.invalidateQueries({ queryKey: ["pet-mensagem-modelos"] });
      if (!texto.trim()) onChange(padrao);
      toast.success(texto.trim() ? "Modelo guardado para toda a equipe" : "Voltou ao texto padrão");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const campos = ["tutor", "pet", "loja", ...CAMPOS_MENSAGEM[tipo]].map((c) => `{${c}}`).join(", ");
  const mudou = valor.trim() !== base.trim();

  return (
    <div className="mb-5">
      <Label htmlFor={id}>Mensagem do WhatsApp</Label>
      <Textarea id={id} rows={3} value={valor} onChange={(e) => onChange(e.target.value)} />
      <p className="mt-1 text-xs text-muted-foreground">
        Use {campos}. {salvo ? "Modelo da empresa." : "Texto padrão do sistema."}
      </p>
      {podeGuardar && (
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!mudou || guardar.isPending || valor.trim().length < 5}
            onClick={() => guardar.mutate(valor)}
          >
            Guardar como modelo da empresa
          </Button>
          {salvo && (
            <Button
              size="sm"
              variant="ghost"
              disabled={guardar.isPending}
              onClick={() => guardar.mutate("")}
            >
              Voltar ao padrão
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
