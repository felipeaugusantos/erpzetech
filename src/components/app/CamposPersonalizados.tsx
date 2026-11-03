import { useQuery } from "@tanstack/react-query";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { camposAtivos, type CampoPet, type EntidadeCampo } from "@/lib/pet-campos";

const NENHUM = "__nenhum";

/** Definições dos campos personalizados da empresa (pet e tutor). */
export function useCamposPet() {
  return useQuery({
    queryKey: ["pet-campos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pet_campos")
        .select("id, entidade, nome, tipo, opcoes, obrigatorio, ordem, ativo")
        .order("ordem")
        .order("nome");
      if (error) throw error;
      return (data ?? []).map((c) => ({
        ...c,
        opcoes: Array.isArray(c.opcoes) ? (c.opcoes as string[]) : [],
      })) as CampoPet[];
    },
  });
}

/** Valores já guardados de um pet ou tutor: { idDoCampo: valor }. */
export function useValoresCamposPet(registroId: string | undefined) {
  return useQuery({
    queryKey: ["pet-campos-valores", registroId],
    enabled: Boolean(registroId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pet_campos_valores")
        .select("campo_id, valor")
        .eq("registro_id", registroId as string);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((v) => [v.campo_id, v.valor]));
    },
  });
}

/** Campos personalizados de um cadastro; quem usa guarda os valores e os envia depois de salvar o pet ou o tutor. */
export function CamposPersonalizados({
  campos,
  entidade,
  valores,
  onChange,
  titulo,
}: {
  campos: readonly CampoPet[];
  entidade: EntidadeCampo;
  valores: Record<string, string>;
  onChange: (campoId: string, valor: string) => void;
  titulo: string;
}) {
  const lista = camposAtivos(campos, entidade);
  if (lista.length === 0) return null;
  return (
    <div className="sm:col-span-2 rounded-md border border-border p-3">
      <p className="mb-2 text-sm font-medium">{titulo}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {lista.map((c) => {
          const id = `cp-${c.id}`;
          const v = valores[c.id] ?? "";
          return (
            <div key={c.id}>
              <Label htmlFor={id}>
                {c.nome}
                {c.obrigatorio && <span className="text-destructive"> *</span>}
              </Label>
              {c.tipo === "lista" || c.tipo === "sim_nao" ? (
                <Select
                  value={v || NENHUM}
                  onValueChange={(x) => onChange(c.id, x === NENHUM ? "" : x)}
                >
                  <SelectTrigger id={id}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NENHUM}>Não informado</SelectItem>
                    {c.tipo === "sim_nao" ? (
                      <>
                        <SelectItem value="sim">Sim</SelectItem>
                        <SelectItem value="nao">Não</SelectItem>
                      </>
                    ) : (
                      c.opcoes.map((o) => (
                        <SelectItem key={o} value={o}>
                          {o}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={id}
                  type={c.tipo === "data" ? "date" : "text"}
                  inputMode={c.tipo === "numero" ? "decimal" : undefined}
                  maxLength={500}
                  value={v}
                  onChange={(e) => onChange(c.id, e.target.value)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
