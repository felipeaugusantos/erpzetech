import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import type { MedicamentoBulario } from "@/lib/bulario";

/**
 * Campo de medicamento da receita com sugestões do bulário veterinário (MAPA). É só ajuda de digitação:
 * o texto continua livre, e sem internet ou sem a base carregada o campo funciona como um campo comum.
 */
export function CampoMedicamento({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const lista = useId();
  const [termo, setTermo] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setTermo(value.trim()), 300);
    return () => clearTimeout(t);
  }, [value]);

  const { data = [] } = useQuery({
    queryKey: ["bulario-sugestao", termo],
    enabled: termo.length >= 3,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("bulario_buscar", {
        p_busca: termo,
        p_limite: 8,
      });
      if (error) throw error;
      return ((data as unknown as { itens: MedicamentoBulario[] }).itens ?? []).map((m) => m.nome);
    },
  });

  return (
    <>
      <Input
        value={value}
        list={lista}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={lista}>
        {[...new Set(data)].map((nome) => (
          <option key={nome} value={nome} />
        ))}
      </datalist>
    </>
  );
}
