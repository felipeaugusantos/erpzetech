import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useOnline } from "@/hooks/useOnline";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatarVersaoLegal, VERSAO_LEGAL } from "@/lib/legal";

/**
 * Pede o aceite dos Termos de Uso e da Política de Privacidade (versão vigente) antes de liberar o sistema.
 * Só bloqueia quando o banco diz que a pessoa ainda NÃO aceitou: sem internet, erro de rede ou migração ainda não aplicada
 * deixam o sistema abrir normalmente (o aceite é pedido na próxima entrada com conexão), para nunca travar o caixa.
 */
export function AceiteLegal({ userId, children }: { userId: string; children: ReactNode }) {
  const qc = useQueryClient();
  const chave = ["aceite-legal", userId, VERSAO_LEGAL] as const;
  const [marcado, setMarcado] = useState(false);
  const online = useOnline();

  const { data: aceitou } = useQuery({
    queryKey: chave,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc("aceite_legal_meu", { p_versao: VERSAO_LEGAL });
      if (error) return true;
      return data === true;
    },
    staleTime: 60 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const aceitar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("aceite_legal_registrar", { p_versao: VERSAO_LEGAL });
      if (error) throw error;
    },
    onSuccess: () => qc.setQueryData(chave, true),
    onError: () =>
      toast.error("Não foi possível registrar o aceite. Confira a internet e tente de novo."),
  });

  // sem internet o sistema abre normalmente (caixa e telas offline); o aceite é pedido na próxima entrada com conexão
  if (!online || aceitou !== false) return <>{children}</>;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="aceite-legal-titulo"
      className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-background/95 p-4 backdrop-blur-sm"
    >
      <div className="panel w-full max-w-md space-y-4 p-6">
        <h2 id="aceite-legal-titulo" className="font-display text-xl font-bold">
          Termos de Uso e Privacidade
        </h2>
        <p className="text-sm text-muted-foreground">
          Antes de continuar, leia e aceite os documentos abaixo (versão de{" "}
          {formatarVersaoLegal(VERSAO_LEGAL)}). Eles explicam como o EZRA ERP funciona e como os
          dados pessoais são tratados, conforme a LGPD.
        </p>
        <ul className="space-y-1 text-sm">
          <li>
            <a
              href="/termos"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-4"
            >
              Termos de Uso
            </a>
          </li>
          <li>
            <a
              href="/privacidade"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-4"
            >
              Política de Privacidade
            </a>
          </li>
        </ul>
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <Checkbox
            checked={marcado}
            onCheckedChange={(v) => setMarcado(v === true)}
            className="mt-0.5"
            aria-label="Li e aceito os Termos de Uso e a Política de Privacidade"
          />
          <span>Li e aceito os Termos de Uso e a Política de Privacidade.</span>
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="ghost"
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.assign("/auth");
            }}
          >
            Sair
          </Button>
          <Button disabled={!marcado || aceitar.isPending} onClick={() => aceitar.mutate()}>
            {aceitar.isPending ? "Registrando..." : "Aceitar e continuar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
