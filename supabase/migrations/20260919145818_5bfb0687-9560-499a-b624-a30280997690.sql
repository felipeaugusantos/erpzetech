-- ===== Contas a pagar da Ze Tech, ligadas às lojas dos clientes =====
create table public.saas_contas_pagar (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.saas_clientes(id) on delete set null,
  loja_id uuid references public.saas_lojas(id) on delete set null,
  descricao text not null,
  categoria text,
  fornecedor text,
  vencimento date not null,
  valor numeric(14,2) not null default 0,
  valor_pago numeric(14,2) not null default 0,
  pago_em date,
  forma_pagamento text,
  situacao text not null default 'aberta',
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index saas_contas_pagar_venc_idx on public.saas_contas_pagar (vencimento);

grant select, insert, update, delete on public.saas_contas_pagar to authenticated;
grant all on public.saas_contas_pagar to service_role;

alter table public.saas_contas_pagar enable row level security;

create policy "Somente equipe Ze Tech gerencia contas a pagar"
  on public.saas_contas_pagar for all to authenticated
  using (eh_saas_operador()) with check (eh_saas_operador());

-- ===== Impostos da nota calculados pela filial escolhida =====
create or replace function public.nfe_calcular_impostos(
  p_nfe_id uuid,
  p_aliquota_icms numeric default null,
  p_aliquota_pis numeric default null,
  p_aliquota_cofins numeric default null,
  p_aliquota_iss numeric default null,
  p_reducao_base numeric default null,
  p_aplicar_icms_em_todos boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_nfe record;
  v_fil_cfg record;   -- configuração da filial emitente
  v_emp_cfg record;   -- configuração padrão da empresa
  v_item record;
  v_codigo text;
  v_uf_emit text; v_uf_dest text; v_fora boolean;
  v_icms_padrao numeric; v_mva numeric;
  v_icms numeric; v_pis numeric; v_cofins numeric; v_iss numeric; v_red numeric;
  v_cst_pis text; v_cst_cofins text;
  v_base numeric; v_v_icms numeric; v_base_st numeric; v_v_st numeric;
  v_tot_base numeric := 0; v_tot_icms numeric := 0;
  v_tot_base_st numeric := 0; v_tot_st numeric := 0;
  v_tot_pis numeric := 0; v_tot_cofins numeric := 0; v_tot_iss numeric := 0;
BEGIN
  SELECT * INTO v_nfe FROM nfe WHERE id = p_nfe_id AND tenant_id = current_tenant_id();
  IF v_nfe IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal não encontrada';
  END IF;
  IF v_nfe.situacao NOT IN ('rascunho', 'pronta') THEN
    RAISE EXCEPTION 'Só é possível recalcular impostos de nota em rascunho ou pronta';
  END IF;

  -- Alíquotas da filial emitente (prioridade) e da empresa (complemento).
  SELECT * INTO v_fil_cfg FROM fiscal_config
   WHERE tenant_id = current_tenant_id()
     AND filial_id = v_nfe.filial_id
   LIMIT 1;

  SELECT * INTO v_emp_cfg FROM fiscal_config
   WHERE tenant_id = current_tenant_id()
     AND filial_id IS NULL
     AND (empresa_id = v_nfe.empresa_id OR empresa_id IS NULL)
   ORDER BY empresa_id NULLS LAST
   LIMIT 1;

  -- Estado da loja emitente x estado do destinatário define interna/interestadual.
  SELECT COALESCE(f.estado, e.estado) INTO v_uf_emit
    FROM empresas e LEFT JOIN filiais f ON f.id = v_nfe.filial_id
   WHERE e.id = v_nfe.empresa_id;
  v_uf_dest := upper(COALESCE(v_nfe.destinatario->>'estado', v_uf_emit, ''));
  v_fora := v_uf_emit IS NOT NULL AND v_uf_dest <> '' AND upper(v_uf_emit) <> v_uf_dest;

  IF v_fora THEN
    v_icms_padrao := COALESCE(NULLIF(v_fil_cfg.aliquota_icms_interestadual, 0),
                              NULLIF(v_emp_cfg.aliquota_icms_interestadual, 0), 0);
  ELSE
    v_icms_padrao := COALESCE(NULLIF(v_fil_cfg.aliquota_icms_interna, 0),
                              NULLIF(v_emp_cfg.aliquota_icms_interna, 0), 0);
  END IF;

  v_mva := COALESCE(NULLIF(v_fil_cfg.mva_st, 0), NULLIF(v_emp_cfg.mva_st, 0), 0);
  v_pis := COALESCE(p_aliquota_pis, NULLIF(v_fil_cfg.aliquota_pis, 0), NULLIF(v_emp_cfg.aliquota_pis, 0), 0);
  v_cofins := COALESCE(p_aliquota_cofins, NULLIF(v_fil_cfg.aliquota_cofins, 0), NULLIF(v_emp_cfg.aliquota_cofins, 0), 0);
  v_iss := COALESCE(p_aliquota_iss, NULLIF(v_fil_cfg.aliquota_iss, 0), NULLIF(v_emp_cfg.aliquota_iss, 0), 0);
  v_red := COALESCE(p_reducao_base, NULLIF(v_fil_cfg.reducao_base_icms, 0), NULLIF(v_emp_cfg.reducao_base_icms, 0), 0);
  v_cst_pis := COALESCE(v_fil_cfg.cst_pis, v_emp_cfg.cst_pis, '99');
  v_cst_cofins := COALESCE(v_fil_cfg.cst_cofins, v_emp_cfg.cst_cofins, '99');

  FOR v_item IN SELECT * FROM nfe_itens WHERE nfe_id = p_nfe_id LOOP
    v_codigo := regexp_replace(COALESCE(v_item.cst_csosn, ''), '\D', '', 'g');
    v_icms := COALESCE(p_aliquota_icms, NULLIF(v_item.aliquota_icms, 0), v_icms_padrao, 0);
    IF p_aliquota_icms IS NOT NULL AND NOT p_aplicar_icms_em_todos AND COALESCE(v_item.aliquota_icms, 0) > 0 THEN
      v_icms := v_item.aliquota_icms;
    END IF;

    v_base := 0; v_v_icms := 0; v_base_st := 0; v_v_st := 0;

    IF v_codigo IN ('00', '10', '20', '70', '90', '900') THEN
      v_base := round(v_item.total * (1 - v_red / 100), 2);
      v_v_icms := round(v_base * v_icms / 100, 2);
    ELSIF v_codigo IN ('60', '500') THEN
      v_base_st := round(v_item.total * (1 + v_mva / 100), 2);
      v_v_st := round(v_base_st * v_icms / 100, 2);
    END IF;

    UPDATE nfe_itens SET
      aliquota_icms = v_icms,
      base_icms = v_base,
      valor_icms = v_v_icms,
      base_icms_st = v_base_st,
      valor_icms_st = v_v_st,
      aliquota_pis = v_pis,
      valor_pis = round(v_item.total * v_pis / 100, 2),
      aliquota_cofins = v_cofins,
      valor_cofins = round(v_item.total * v_cofins / 100, 2),
      aliquota_iss = v_iss,
      valor_iss = round(v_item.total * v_iss / 100, 2),
      cst_pis = v_cst_pis,
      cst_cofins = v_cst_cofins
     WHERE id = v_item.id;

    v_tot_base := v_tot_base + v_base;
    v_tot_icms := v_tot_icms + v_v_icms;
    v_tot_base_st := v_tot_base_st + v_base_st;
    v_tot_st := v_tot_st + v_v_st;
    v_tot_pis := v_tot_pis + round(v_item.total * v_pis / 100, 2);
    v_tot_cofins := v_tot_cofins + round(v_item.total * v_cofins / 100, 2);
    v_tot_iss := v_tot_iss + round(v_item.total * v_iss / 100, 2);
  END LOOP;

  UPDATE nfe SET
    base_icms = v_tot_base,
    valor_icms = v_tot_icms,
    base_icms_st = v_tot_base_st,
    valor_icms_st = v_tot_st,
    valor_pis = v_tot_pis,
    valor_cofins = v_tot_cofins,
    valor_iss = v_tot_iss,
    impostos_calculados_em = now(),
    updated_at = now()
   WHERE id = p_nfe_id;

  RETURN jsonb_build_object(
    'base_icms', v_tot_base, 'valor_icms', v_tot_icms,
    'base_icms_st', v_tot_base_st, 'valor_icms_st', v_tot_st,
    'valor_pis', v_tot_pis, 'valor_cofins', v_tot_cofins, 'valor_iss', v_tot_iss,
    'config_filial', v_fil_cfg.id IS NOT NULL,
    'uf_emitente', v_uf_emit, 'uf_destinatario', v_uf_dest,
    'interestadual', v_fora, 'aliquota_icms_padrao', v_icms_padrao,
    'aliquota_pis', v_pis, 'aliquota_cofins', v_cofins, 'aliquota_iss', v_iss
  );
END;
$function$;
revoke all on function public.nfe_calcular_impostos(uuid, numeric, numeric, numeric, numeric, numeric, boolean) from public, anon;
grant execute on function public.nfe_calcular_impostos(uuid, numeric, numeric, numeric, numeric, numeric, boolean) to authenticated;