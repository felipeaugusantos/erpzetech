import { useMemo } from "react";

import { brl } from "@/lib/format";
import { estimarIbsCbsPedido, situacaoIbsCbs, type ItemEstimativa } from "@/lib/ibs-cbs-simulacao";

/**
 * Estimativa do IBS/CBS do pedido (Reforma Tributária), antes da nota. Só mostra valores quando a NF-e deste regime
 * já leva o grupo; nos demais regimes explica por que ainda não aparece. Informativo: não grava nada.
 */
export function EstimativaIbsCbs({
  itens,
  regime,
}: {
  itens: readonly ItemEstimativa[];
  regime: string | null | undefined;
}) {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const situacao = situacaoIbsCbs(regime, hoje.toISOString().slice(0, 10));
  const est = useMemo(() => estimarIbsCbsPedido(itens, ano), [itens, ano]);

  if (itens.length === 0) return null;

  if (situacao !== "obrigatorio") {
    return (
      <div className="panel p-4 text-sm">
        <p className="font-display font-semibold">IBS e CBS (Reforma Tributária)</p>
        <p className="mt-2 text-xs text-muted-foreground">
          A NF-e deste regime ainda não envia o IBS/CBS (vale a partir de 04/01/2027, com orientação
          em nota técnica futura). Para simular, use Simulação de nota fiscal.
        </p>
      </div>
    );
  }

  return (
    <div className="panel p-4 text-sm">
      <p className="font-display font-semibold">IBS e CBS (estimativa)</p>
      <div className="mt-2 space-y-1">
        <p className="flex justify-between">
          <span className="text-muted-foreground">IBS</span>
          <span>{brl(est.totais.vIBS)}</span>
        </p>
        <p className="flex justify-between">
          <span className="text-muted-foreground">CBS</span>
          <span>{brl(est.totais.vCBS)}</span>
        </p>
        <p className="flex justify-between font-semibold">
          <span>IBS + CBS</span>
          <span>{brl(est.totais.vIBS + est.totais.vCBS)}</span>
        </p>
      </div>
      {est.comErro.length > 0 && (
        <div className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
          <p className="font-medium">A nota deste pedido seria recusada:</p>
          <ul className="mt-1 list-disc pl-4">
            {est.comErro.slice(0, 3).map((e) => (
              <li key={e.id}>
                {e.descricao}: {e.motivo}
              </li>
            ))}
            {est.comErro.length > 3 && <li>e mais {est.comErro.length - 3} item(ns)</li>}
          </ul>
          <p className="mt-1 text-muted-foreground">
            Corrija a classificação IBS/CBS no cadastro do produto.
          </p>
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Estimativa com as alíquotas de {ano} e a classificação de cada produto (em branco,
        tributação integral). A base é o valor dos itens: a nota desconta ICMS, PIS e COFINS, então
        o valor dela sai um pouco menor. Só informativo.
      </p>
    </div>
  );
}
