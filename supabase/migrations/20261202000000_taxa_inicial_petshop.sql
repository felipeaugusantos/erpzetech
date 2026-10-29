-- Taxa inicial do pet shop: passa a valer R$ 299 de treinamento e configuração inicial, taxa única, como clínica e lava-rápido.
-- Só troca a lista de segmentos da regra: as telas e a cobrança leem desta função. A implantação de filial/empresa adicional,
-- as mensalidades e os planos não mudam.
CREATE OR REPLACE FUNCTION public.taxa_inicial_segmento(p_ramo text)
RETURNS TABLE (valor numeric, rotulo text)
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT 299::numeric, 'Treinamento e configuração inicial'::text
   WHERE p_ramo IN ('petshop', 'clinica', 'lavarapido')
$$;
