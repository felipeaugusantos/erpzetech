import { useQuery } from "@tanstack/react-query";

import { ncmDigitos } from "@/lib/fiscal-sugestao";

/**
 * Aviso no cadastro de produto quando o NCM de 8 dígitos não consta na Tabela NCM vigente (dígito trocado ou código inventado).
 * Só avisa: não impede salvar, porque a tabela muda por resolução da Gecex e quem decide é o contador.
 * A tabela (cerca de 65 KB) é carregada só quando há um NCM completo para conferir.
 */
export function AvisoNcm({ ncm }: { ncm: string }) {
  const digitos = ncmDigitos(ncm);
  const consulta = useQuery({
    queryKey: ["ncm-na-tabela", digitos],
    enabled: digitos.length === 8,
    staleTime: 60_000,
    gcTime: 60_000,
    retry: false,
    queryFn: async () => {
      const m = await import("@/lib/ncm");
      return { existe: m.ncmNaTabela(digitos), vigencia: m.vigenciaTabelaNcm() };
    },
  });
  if (digitos.length !== 8 || !consulta.data || consulta.data.existe) return null;
  return (
    <p role="alert" className="mt-1 text-xs text-warning">
      Este NCM não consta na Tabela NCM vigente em {consulta.data.vigencia}. Confira os dígitos;
      você ainda pode salvar.
    </p>
  );
}
