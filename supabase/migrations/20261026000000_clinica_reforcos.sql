-- Clínica (Fase 3, PR 4): reforços. A recepção vê quais pets estão com vacina ou vermífugo para tomar (ou atrasado), chama no WhatsApp
-- ou marca "já falei", e o pet sai da lista naquela data. Reaproveita os contatos do pet shop (pet_contatos, tipo "reforco").
-- A lista traz só o nome do item e a data: nada do prontuário. Sem envio automático: o clique é da recepção.

ALTER TABLE public.pet_contatos DROP CONSTRAINT IF EXISTS pet_contatos_tipo_check;
ALTER TABLE public.pet_contatos ADD CONSTRAINT pet_contatos_tipo_check CHECK (tipo IN ('aniversario', 'retorno', 'reforco'));

-- Registrar contato de reforço também exige a clínica liberada.
DO $$
DECLARE
  def text;
  nova text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pet_contato_registrar';
  IF def IS NULL THEN RAISE EXCEPTION 'pet_contato_registrar não encontrada'; END IF;
  IF position('''reforco''' IN def) > 0 THEN RETURN; END IF;
  nova := replace(def, E'IF p_tipo NOT IN (''aniversario'', ''retorno'') THEN RAISE EXCEPTION ''Tipo de contato inválido''; END IF;',
    E'IF p_tipo NOT IN (''aniversario'', ''retorno'', ''reforco'') THEN RAISE EXCEPTION ''Tipo de contato inválido''; END IF;\n'
    || E'  IF p_tipo = ''reforco'' AND NOT public.clinica_liberada() THEN RAISE EXCEPTION ''A clínica não está liberada para esta empresa''; END IF;');
  IF nova = def THEN RAISE EXCEPTION 'pet_contato_registrar: trecho esperado não encontrado'; END IF;
  EXECUTE nova;
END $$;

-- Pets com vacina/vermífugo a tomar nos próximos p_janela dias ou atrasado até p_atraso dias. Uma linha por pet e data, com os itens daquela data.
-- Vale a aplicação mais recente de cada item (aplicação cancelada não conta; "sem próxima dose" tira o item da lista); item inativo no
-- catálogo e pet com vacina já agendada não entram; quem já foi chamado para aquela data sai.
CREATE OR REPLACE FUNCTION public.clinica_reforcos_pendentes(p_janela integer DEFAULT 15, p_atraso integer DEFAULT 180)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  IF p_janela IS NULL OR p_janela < 0 OR p_janela > 60 THEN RAISE EXCEPTION 'A janela precisa ficar entre 0 e 60 dias'; END IF;
  IF p_atraso IS NULL OR p_atraso < 0 OR p_atraso > 730 THEN RAISE EXCEPTION 'O atraso precisa ficar entre 0 e 730 dias'; END IF;
  -- o teto de 300 vale para a lista (as datas mais antigas primeiro), então é aplicado antes de agregar
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('pet_id', g.pet_id, 'pet', g.pet, 'especie', g.especie, 'tutor', g.tutor, 'telefone', g.telefone,
                                         'referencia', g.ref, 'dias', g.ref - v_hoje, 'itens', g.itens) ORDER BY g.ref, g.pet)
      FROM (
        SELECT q.pet_id, q.pet, q.especie, q.tutor, q.telefone, q.ref,
               jsonb_agg(jsonb_build_object('nome', q.nome, 'tipo', q.tipo) ORDER BY q.nome) AS itens
          FROM (
            SELECT DISTINCT ON (v.pet_id, v.catalogo_id)
                   v.pet_id, p.nome AS pet, p.especie, c.nome AS tutor, c.telefone, v.proxima_dose_em AS ref, v.nome, v.tipo
              FROM public.pet_vacinacoes v
              JOIN public.pets p ON p.id = v.pet_id
              JOIN public.clientes c ON c.id = p.cliente_id
              JOIN public.pet_vacinas_catalogo k ON k.id = v.catalogo_id AND k.ativo
             WHERE v.tenant_id = v_tenant AND v.situacao = 'ativa' AND p.ativo
             ORDER BY v.pet_id, v.catalogo_id, v.aplicada_em DESC, v.created_at DESC
          ) q
         WHERE q.ref IS NOT NULL AND q.ref BETWEEN v_hoje - p_atraso AND v_hoje + p_janela
           AND NOT EXISTS (SELECT 1 FROM public.pet_contatos t WHERE t.pet_id = q.pet_id AND t.tipo = 'reforco' AND t.referencia = q.ref)
           AND NOT EXISTS (SELECT 1 FROM public.pet_agendamentos a
                             JOIN public.pet_agendamento_itens i ON i.agendamento_id = a.id
                             JOIN public.pet_servicos s ON s.id = i.servico_id
                            WHERE a.pet_id = q.pet_id AND s.categoria = 'vacina'
                              AND a.situacao IN ('agendado', 'confirmado', 'em_atendimento') AND a.inicio >= now() - interval '1 day')
         GROUP BY q.pet_id, q.pet, q.especie, q.tutor, q.telefone, q.ref
         ORDER BY q.ref, q.pet
         LIMIT 300
      ) g
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_reforcos_pendentes(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_reforcos_pendentes(integer, integer) TO authenticated;
