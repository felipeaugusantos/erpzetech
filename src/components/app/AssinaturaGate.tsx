import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { lerSituacaoAssinatura, type SituacaoAssinatura } from "@/lib/cobranca-gateway";
import { brl, dateBR } from "@/lib/format";
import { DADOS_LEGAIS } from "@/lib/legal";

/**
 * Mostra o aviso de fatura vencida e, quando a assinatura está suspensa por falta de pagamento, a tela de bloqueio com os links
 * de pagamento (só para administrador e gestor; os demais são orientados a falar com o administrador).
 * Só atua para empresa com cobrança automática: o banco devolve nada para as demais, para a equipe EZRA e para contador.
 * Qualquer erro (sem internet, função ainda não aplicada) deixa o sistema abrir normalmente, para nunca travar o caixa por engano.
 * O bloqueio é da tela; a proteção dos dados continua sendo o login e o isolamento por empresa no banco.
 */
export function AssinaturaGate({ userId, children }: { userId: string; children: ReactNode }) {
  const { data: situacao } = useQuery({
    queryKey: ["assinatura-situacao", userId],
    queryFn: async (): Promise<SituacaoAssinatura | null> => {
      const { data, error } = await supabase.rpc("assinatura_situacao");
      if (error) return null;
      return lerSituacaoAssinatura(data);
    },
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: true,
  });

  if (situacao?.bloqueado) return <TelaDeBloqueio situacao={situacao} />;
  return (
    <>
      {situacao?.emAtraso && situacao.faturas.length > 0 && <AvisoDeAtraso situacao={situacao} />}
      {children}
    </>
  );
}

function ListaDeFaturas({ situacao }: { situacao: SituacaoAssinatura }) {
  return (
    <ul className="space-y-2">
      {situacao.faturas.map((f) => (
        <li
          key={f.id}
          className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"
        >
          <span>
            <span className="font-medium">{f.descricao}</span>
            <br />
            <span className="text-muted-foreground">
              {brl(f.valor)} · vencimento {dateBR(f.vencimento)}
            </span>
          </span>
          {f.url ? (
            <Button asChild size="sm">
              <a href={f.url} target="_blank" rel="noopener noreferrer">
                Pagar <ExternalLink className="ml-1 size-3.5" />
              </a>
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">Link em preparo</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function AvisoDeAtraso({ situacao }: { situacao: SituacaoAssinatura }) {
  const restam = Math.max(situacao.toleranciaDias - situacao.diasAtraso, 0);
  return (
    <div
      role="alert"
      className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
    >
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4 shrink-0" />
        Há fatura da assinatura vencida há {situacao.diasAtraso} dia(s) (
        {brl(situacao.valorEmAberto)}).{" "}
        {restam > 0
          ? `Pague em até ${restam} dia(s) para o acesso não ser suspenso.`
          : "O acesso será suspenso a qualquer momento."}
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer underline underline-offset-4">
          Ver faturas e pagar
        </summary>
        <div className="mt-2 max-w-xl">
          <ListaDeFaturas situacao={situacao} />
        </div>
      </details>
    </div>
  );
}

function TelaDeBloqueio({ situacao }: { situacao: SituacaoAssinatura }) {
  const temFaturas = situacao.faturas.length > 0;
  return (
    <div className="grid min-h-screen place-items-center bg-background p-4">
      <div className="panel w-full max-w-lg space-y-4 p-6">
        <h1 className="font-display text-xl font-bold">
          Acesso suspenso por pendência de pagamento
        </h1>
        <p className="text-sm text-muted-foreground">
          A assinatura do EZRA ERP está com fatura vencida há mais de {situacao.toleranciaDias}{" "}
          dias. O acesso volta sozinho, em poucos instantes, depois da confirmação do pagamento.
          Seus dados estão guardados e não foram apagados.
        </p>
        {temFaturas ? (
          <ListaDeFaturas situacao={situacao} />
        ) : (
          <p className="rounded-md border border-border p-3 text-sm">
            Peça ao administrador da empresa para pagar a fatura, ou fale com a EZRA:{" "}
            {DADOS_LEGAIS.email}.
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button variant="outline" onClick={() => window.location.reload()}>
            Já paguei, verificar de novo
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.assign("/auth");
            }}
          >
            Sair
          </Button>
        </div>
      </div>
    </div>
  );
}
