import { useMemo } from "react";

import { CLASSIFICACOES, SITUACOES, TRIBUTACAO_INTEGRAL, motivoNaoSuportada } from "@/lib/ibs-cbs";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PADRAO = "padrao";

/** Classificação do item no IBS/CBS (CST + cClassTrib). Só oferece as combinações que o sistema já sabe calcular. */
export function ClassificacaoIbsCbs({
  cst,
  cClassTrib,
  onChange,
}: {
  cst: string;
  cClassTrib: string;
  onChange: (cst: string, cClassTrib: string) => void;
}) {
  const csts = useMemo(
    () =>
      SITUACOES.filter((s) =>
        CLASSIFICACOES.some(
          (c) => c.cst === s.cst && motivoNaoSuportada(c.cst, c.cClassTrib) === null,
        ),
      ),
    [],
  );
  const classes = useMemo(
    () =>
      CLASSIFICACOES.filter(
        (c) => c.cst === cst && motivoNaoSuportada(c.cst, c.cClassTrib) === null,
      ),
    [cst],
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label>Tributação IBS/CBS (reforma tributária)</Label>
        <Select
          value={cst || PADRAO}
          onValueChange={(v) => {
            if (v === PADRAO) onChange("", "");
            else
              onChange(
                v,
                CLASSIFICACOES.find((c) => c.cst === v && !motivoNaoSuportada(c.cst, c.cClassTrib))
                  ?.cClassTrib ?? "",
              );
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={PADRAO}>
              {TRIBUTACAO_INTEGRAL.cst} — Tributação integral (padrão)
            </SelectItem>
            {csts
              .filter((s) => s.cst !== TRIBUTACAO_INTEGRAL.cst)
              .map((s) => (
                <SelectItem key={s.cst} value={s.cst}>
                  {s.cst} — {s.descricao}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">
          Em branco, a nota sai com tributação integral. Mude só para produto com alíquota reduzida,
          isento ou imune.
        </p>
      </div>
      {cst && (
        <div>
          <Label>Classificação (cClassTrib)</Label>
          <Select value={cClassTrib} onValueChange={(v) => onChange(cst, v)}>
            <SelectTrigger>
              <SelectValue placeholder="Escolha a classificação" />
            </SelectTrigger>
            <SelectContent>
              {classes.map((c) => (
                <SelectItem key={c.cClassTrib} value={c.cClassTrib}>
                  {c.cClassTrib} — {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
