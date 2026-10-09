import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { useCaixasAbertos } from "@/hooks/useCaixasAbertos";
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
import { brl } from "@/lib/format";
import { formasPagamento } from "@/lib/financeiro";
import { dividirConta } from "@/lib/restaurante";
import {
  paraNumero,
  paraTexto,
  linhaInicial,
  type LinhaPagamento,
} from "@/lib/restaurante-pagamentos";

// só formas que entram na hora: boleto e crediário são a prazo e não passam pelo caixa
const formas = formasPagamento.filter((f) => f.value !== "crediario" && f.value !== "boleto");

/**
 * Caixa, divisão entre pagantes e formas de pagamento de uma conta ou de uma baixa parcial.
 * `alvo` é o valor que os pagamentos precisam somar.
 */
export function PagamentosForm({
  alvo,
  linhas,
  onLinhas,
  caixaId,
  onCaixa,
  filialId,
}: {
  alvo: number;
  linhas: LinhaPagamento[];
  onLinhas: (l: LinhaPagamento[]) => void;
  caixaId: string;
  onCaixa: (id: string) => void;
  filialId: string | null;
}) {
  const [partes, setPartes] = useState("2");
  const { data: caixas = [] } = useCaixasAbertos(filialId);

  useEffect(() => {
    if (!caixaId && caixas.length === 1) onCaixa(caixas[0]!.id);
  }, [caixas, caixaId, onCaixa]);

  // com um único pagamento, o valor acompanha o alvo
  useEffect(() => {
    if (linhas.length === 1 && paraNumero(linhas[0]!.valor) !== alvo) {
      onLinhas([{ ...linhas[0]!, valor: paraTexto(alvo) }]);
    }
  }, [alvo, linhas, onLinhas]);

  const pago = Math.round(linhas.reduce((s, l) => s + paraNumero(l.valor), 0) * 100) / 100;
  const diferenca = Math.round((alvo - pago) * 100) / 100;

  const alterar = (i: number, parcial: Partial<LinhaPagamento>) =>
    onLinhas(linhas.map((x, j) => (j === i ? { ...x, ...parcial } : x)));

  function dividir() {
    const n = Math.max(Math.floor(Number(partes)) || 1, 1);
    onLinhas(dividirConta(alvo, n).map((v) => ({ ...linhaInicial(), valor: paraTexto(v) })));
  }

  return (
    <div className="grid gap-3">
      <div>
        <Label>Caixa que recebe</Label>
        <Select value={caixaId} onValueChange={onCaixa}>
          <SelectTrigger aria-label="Caixa que recebe">
            <SelectValue placeholder={caixas.length ? "Escolha o caixa" : "Nenhum caixa aberto"} />
          </SelectTrigger>
          <SelectContent>
            {caixas.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                Caixa {c.numero}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-end gap-2">
        <div className="w-24">
          <Label htmlFor="partes">Dividir por</Label>
          <Input
            id="partes"
            inputMode="numeric"
            value={partes}
            onChange={(e) => setPartes(e.target.value)}
          />
        </div>
        <Button type="button" variant="outline" onClick={dividir}>
          Dividir igualmente
        </Button>
      </div>

      {linhas.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_6.5rem_1fr_auto] items-end gap-2">
          <div>
            <Label className="text-xs">Forma</Label>
            <Select value={l.forma} onValueChange={(v) => alterar(i, { forma: v })}>
              <SelectTrigger aria-label="Forma de pagamento">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {formas.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Valor</Label>
            <Input
              inputMode="decimal"
              value={l.valor}
              onChange={(e) => alterar(i, { valor: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Quem paga</Label>
            <Input value={l.pagante} onChange={(e) => alterar(i, { pagante: e.target.value })} />
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Remover pagamento"
            disabled={linhas.length === 1}
            onClick={() => onLinhas(linhas.filter((_, j) => j !== i))}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onLinhas([
              ...linhas,
              { forma: "pix", valor: diferenca > 0 ? paraTexto(diferenca) : "", pagante: "" },
            ])
          }
        >
          <Plus className="mr-1 size-4" /> Outro pagamento
        </Button>
        <span className={diferenca === 0 ? "text-sm text-emerald-700" : "text-sm text-destructive"}>
          {diferenca === 0
            ? "Pagamentos conferem"
            : diferenca > 0
              ? `Faltam ${brl(diferenca)}`
              : `Passou ${brl(-diferenca)}`}
        </span>
      </div>
    </div>
  );
}
