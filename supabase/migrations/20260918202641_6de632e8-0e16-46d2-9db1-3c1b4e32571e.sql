CREATE OR REPLACE FUNCTION public.banco_mov_somente_conciliar()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.conta_id <> OLD.conta_id OR NEW.valor <> OLD.valor OR NEW.data <> OLD.data
     OR NEW.tipo <> OLD.tipo OR COALESCE(NEW.descricao,'') <> COALESCE(OLD.descricao,'') THEN
    RAISE EXCEPTION 'Lançamento bancário não pode ser alterado: registre um lançamento de ajuste';
  END IF;
  RETURN NEW;
END;
$$;