import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MODULOS_PRODUTO, moduloDoRamo } from "@/lib/modulos-produto";

const NENHUM = "__nenhum";

/**
 * Campos do cadastro de produto que mudam conforme o módulo da empresa (Material de Construção, Pet Shop,
 * Clínica Veterinária, Lava-Rápido). Quem não tem módulo com cadastro próprio não vê nada.
 */
export function CamposDoModulo({
  ramo,
  valores,
  onChange,
  controlaLote,
  onControlaLote,
  loteObrigatorio,
}: {
  ramo: string | null | undefined;
  valores: Record<string, string | boolean>;
  onChange: (chave: string, valor: string | boolean) => void;
  controlaLote: boolean;
  onControlaLote: (v: boolean) => void;
  loteObrigatorio: boolean;
}) {
  const modulo = moduloDoRamo(ramo);
  if (!modulo) return null;
  const def = MODULOS_PRODUTO[modulo];
  return (
    <div className="rounded-md border border-border p-3">
      <p className="mb-1 text-sm font-semibold">Dados de {def.rotulo}</p>
      <p className="mb-3 text-xs text-muted-foreground">
        Campos do cadastro de produto do módulo da sua empresa.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {def.campos.map((c) => {
          const id = `pm-${c.chave}`;
          const v = valores[c.chave];
          if (c.tipo === "booleano")
            return (
              <div key={c.chave} className="flex items-start gap-2 sm:col-span-3">
                <Switch
                  id={id}
                  checked={v === true}
                  onCheckedChange={(x) => onChange(c.chave, x)}
                />
                <div>
                  <Label htmlFor={id}>{c.rotulo}</Label>
                  {c.ajuda && <p className="text-xs text-muted-foreground">{c.ajuda}</p>}
                </div>
              </div>
            );
          return (
            <div key={c.chave}>
              <Label htmlFor={id}>
                {c.rotulo}
                {c.obrigatorio && <span className="text-destructive"> *</span>}
              </Label>
              {c.tipo === "opcoes" ? (
                <Select
                  value={typeof v === "string" && v ? v : NENHUM}
                  onValueChange={(x) => onChange(c.chave, x === NENHUM ? "" : x)}
                >
                  <SelectTrigger id={id}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {!c.obrigatorio && <SelectItem value={NENHUM}>Não informado</SelectItem>}
                    {c.obrigatorio && <SelectItem value={NENHUM}>Escolha…</SelectItem>}
                    {c.opcoes?.map((o) => (
                      <SelectItem key={o.valor} value={o.valor}>
                        {o.rotulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={id}
                  inputMode={c.tipo === "numero" ? "decimal" : undefined}
                  value={typeof v === "string" ? v : ""}
                  placeholder={c.placeholder}
                  onChange={(e) => onChange(c.chave, e.target.value)}
                />
              )}
              {c.ajuda && <p className="mt-1 text-xs text-muted-foreground">{c.ajuda}</p>}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-start gap-2">
        <Switch
          id="pm-lote"
          checked={loteObrigatorio || controlaLote}
          disabled={loteObrigatorio}
          onCheckedChange={onControlaLote}
        />
        <div>
          <Label htmlFor="pm-lote">Controlar lote e validade</Label>
          <p className="text-xs text-muted-foreground">
            {loteObrigatorio
              ? "Medicamento e vacina sempre controlam lote e validade."
              : "Marque se o produto tem lote e validade (ração, insumos, medicamentos)."}
          </p>
        </div>
      </div>
    </div>
  );
}
