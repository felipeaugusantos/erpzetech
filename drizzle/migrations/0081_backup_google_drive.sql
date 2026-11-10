CREATE TABLE public.backup_drive_config (
 tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),
 user_id uuid NOT NULL UNIQUE,
 connection_key_ciphertext text,
 pasta_id text,
 ativo boolean NOT NULL DEFAULT false,
 reconectar boolean NOT NULL DEFAULT false,
 nonce_hash text,
 nonce_expira timestamptz,
 lease_id uuid,
 lease_expira timestamptz,
 erro text,
 atualizado_em timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.backup_drive_config TO service_role;
ALTER TABLE public.backup_drive_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY salao_restrito ON public.backup_drive_config AS RESTRICTIVE TO authenticated USING (false) WITH CHECK (false);
CREATE TABLE public.backup_drive_execucoes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 dia date NOT NULL,
 tipos text[] NOT NULL,
 situacao text NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente','concluido','erro','expirado')),
 arquivo_id text,
 tamanho bigint,
 md5 text,
 tentativas integer NOT NULL DEFAULT 0,
 erro text,
 concluido_em timestamptz,
 UNIQUE (tenant_id, dia)
);
GRANT ALL ON public.backup_drive_execucoes TO service_role;
ALTER TABLE public.backup_drive_execucoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY salao_restrito ON public.backup_drive_execucoes AS RESTRICTIVE TO authenticated USING (false) WITH CHECK (false);
CREATE FUNCTION public.backup_drive_reservar(p_tenant uuid, p_dia date, p_tipos text[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.backup_drive_config; e public.backup_drive_execucoes; token uuid;
BEGIN
 SELECT * INTO c FROM public.backup_drive_config WHERE tenant_id=p_tenant FOR UPDATE;
 IF NOT FOUND OR NOT c.ativo OR c.reconectar OR c.connection_key_ciphertext IS NULL OR c.pasta_id IS NULL OR c.lease_expira > now() THEN RETURN NULL; END IF;
 INSERT INTO public.backup_drive_execucoes(tenant_id,dia,tipos) VALUES(p_tenant,p_dia,p_tipos) ON CONFLICT(tenant_id,dia) DO NOTHING;
 SELECT * INTO e FROM public.backup_drive_execucoes WHERE tenant_id=p_tenant AND dia=p_dia FOR UPDATE;
 IF e.situacao IN ('concluido','expirado') OR e.tentativas >= 3 THEN RETURN NULL; END IF;
 token := gen_random_uuid();
 UPDATE public.backup_drive_config SET lease_id=token,lease_expira=now()+interval '10 minutes' WHERE tenant_id=p_tenant;
 UPDATE public.backup_drive_execucoes SET tentativas=tentativas+1,situacao='pendente',erro=NULL WHERE id=e.id;
 RETURN token;
END $$;
REVOKE ALL ON FUNCTION public.backup_drive_reservar(uuid,date,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.backup_drive_reservar(uuid,date,text[]) TO service_role;