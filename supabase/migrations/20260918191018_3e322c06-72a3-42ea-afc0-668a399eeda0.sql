ALTER TABLE public.profissionais ADD COLUMN IF NOT EXISTS cliente_id uuid REFERENCES public.clientes(id);

CREATE TABLE public.premiacao_abatimentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  profissional_id uuid not null references public.profissionais(id),
  conta_receber_id uuid not null references public.contas_receber(id),
  valor numeric(14,2) not null,
  data date not null default current_date,
  observacao text,
  usuario_id uuid,
  created_at timestamptz not null default now()
);

GRANT SELECT, INSERT ON public.premiacao_abatimentos TO authenticated;
GRANT ALL ON public.premiacao_abatimentos TO service_role;

ALTER TABLE public.premiacao_abatimentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "premiacao_abatimentos_select" ON public.premiacao_abatimentos FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "premiacao_abatimentos_insert" ON public.premiacao_abatimentos FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
    and (public.has_role(auth.uid(),'administrador') or public.has_role(auth.uid(),'gestor')
         or public.has_role(auth.uid(),'financeiro')));

CREATE INDEX idx_premiacao_abatimentos_prof ON public.premiacao_abatimentos(profissional_id);

-- histórico financeiro não se altera nem se apaga
CREATE TRIGGER trg_premiacao_abatimentos_sem_update BEFORE UPDATE OR DELETE ON public.premiacao_abatimentos
  FOR EACH ROW EXECUTE FUNCTION public.block_write();

-- Saldo de crédito disponível do profissional
CREATE OR REPLACE FUNCTION public.profissional_saldo_credito(p_profissional_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select greatest(
    coalesce((select sum(valor) from public.premiacoes
              where profissional_id = p_profissional_id
                and tenant_id = public.current_tenant_id()
                and situacao in ('a_aprovar','aprovada')), 0)
    - coalesce((select sum(valor) from public.premiacao_abatimentos
                where profissional_id = p_profissional_id
                  and tenant_id = public.current_tenant_id()), 0)
  , 0);
$$;

-- Usar o crédito do profissional para abater uma conta a receber
CREATE OR REPLACE FUNCTION public.premiacao_abater_conta(
  p_profissional_id uuid,
  p_conta_id uuid,
  p_valor numeric,
  p_observacao text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_saldo_credito numeric;
  v_saldo_conta numeric;
  v_id uuid;
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if not (public.has_role(auth.uid(),'administrador') or public.has_role(auth.uid(),'gestor')
          or public.has_role(auth.uid(),'financeiro')) then
    raise exception 'Sem permissão para usar o crédito do profissional';
  end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe um valor maior que zero'; end if;

  select (valor - coalesce(valor_recebido,0)) into v_saldo_conta
  from public.contas_receber
  where id = p_conta_id and tenant_id = v_tenant and situacao in ('aberto','parcial');
  if v_saldo_conta is null then raise exception 'Conta a receber não encontrada ou já quitada'; end if;
  if p_valor > v_saldo_conta then
    raise exception 'Valor maior que o saldo da conta (saldo: %)', v_saldo_conta;
  end if;

  v_saldo_credito := public.profissional_saldo_credito(p_profissional_id);
  if p_valor > v_saldo_credito then
    raise exception 'Crédito do profissional insuficiente (disponível: %)', v_saldo_credito;
  end if;

  insert into public.premiacao_abatimentos
    (tenant_id, profissional_id, conta_receber_id, valor, observacao, usuario_id)
  values (v_tenant, p_profissional_id, p_conta_id, round(p_valor,2),
    coalesce(nullif(p_observacao,''), 'Abatimento com crédito de premiação'), auth.uid())
  returning id into v_id;

  perform public.baixar_conta('receber', p_conta_id, round(p_valor,2), 'transferencia'::forma_pagamento,
    current_date, coalesce(nullif(p_observacao,''), 'Abatimento com crédito de premiação do profissional'), null);

  return v_id;
end $$;

-- Converter o profissional em cliente (ou vincular ao cliente existente)
CREATE OR REPLACE FUNCTION public.profissional_converter_em_cliente(p_profissional_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_tenant uuid := public.current_tenant_id();
  pr public.profissionais;
  v_cliente uuid;
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if not (public.has_role(auth.uid(),'administrador') or public.has_role(auth.uid(),'gestor')
          or public.has_role(auth.uid(),'vendedor')) then
    raise exception 'Sem permissão para cadastrar cliente';
  end if;
  select * into pr from public.profissionais where id = p_profissional_id and tenant_id = v_tenant;
  if pr.id is null then raise exception 'Profissional não encontrado'; end if;
  if pr.cliente_id is not null then return pr.cliente_id; end if;

  if pr.cpf is not null and length(regexp_replace(pr.cpf,'\D','','g')) > 0 then
    select id into v_cliente from public.clientes
     where tenant_id = v_tenant
       and regexp_replace(coalesce(cpf,''),'\D','','g') = regexp_replace(pr.cpf,'\D','','g')
     limit 1;
  end if;

  if v_cliente is null then
    insert into public.clientes (tenant_id, empresa_id, nome, tipo_pessoa, cpf, telefone, whatsapp,
      email, profissional_id, observacoes)
    values (v_tenant, pr.empresa_id, pr.nome, 'PF'::pessoa_tipo, pr.cpf, pr.telefone, pr.whatsapp,
      pr.email, pr.id, 'Cliente criado a partir do cadastro de profissional')
    returning id into v_cliente;
  else
    update public.clientes set profissional_id = pr.id where id = v_cliente and profissional_id is null;
  end if;

  update public.profissionais set cliente_id = v_cliente where id = pr.id;
  return v_cliente;
end $$;

REVOKE ALL ON FUNCTION public.profissional_saldo_credito(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.premiacao_abater_conta(uuid, uuid, numeric, text) FROM anon;
REVOKE ALL ON FUNCTION public.profissional_converter_em_cliente(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.profissional_saldo_credito(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.premiacao_abater_conta(uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.profissional_converter_em_cliente(uuid) TO authenticated;