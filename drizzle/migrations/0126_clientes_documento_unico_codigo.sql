CREATE OR REPLACE FUNCTION public._clientes_documento_unico()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_doc text; v_nome text;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  v_doc := regexp_replace(coalesce(nullif(NEW.cpf,''), NEW.cnpj, ''), '\D', '', 'g');
  IF v_doc = '' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND v_doc = regexp_replace(coalesce(nullif(OLD.cpf,''), OLD.cnpj, ''), '\D', '', 'g')
     AND OLD.deleted_at IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT nome INTO v_nome FROM public.clientes c
   WHERE c.tenant_id = NEW.tenant_id AND c.id <> NEW.id AND c.deleted_at IS NULL
     AND regexp_replace(coalesce(nullif(c.cpf,''), c.cnpj, ''), '\D', '', 'g') = v_doc
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Já existe um cadastro com este CPF/CNPJ: %.', v_nome;
  END IF;
  RETURN NEW;
END $$;