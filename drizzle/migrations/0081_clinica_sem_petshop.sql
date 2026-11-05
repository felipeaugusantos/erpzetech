-- Contrato "só clínica, sem pet shop": a liberação 'clinica' continua liberando também o pet shop (padrão atual, ninguém existente muda).
-- O marcador 'sem_petshop', gravado só pela equipe (service_role, como as demais liberações), faz o app esconder os serviços de pet shop
-- e manter só Pets e tutores e Contatos. O marcador não é um módulo: só precisa caber na tabela de liberações.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.empresa_modulos_liberados'::regclass AND contype = 'c' LOOP
    EXECUTE format('ALTER TABLE public.empresa_modulos_liberados DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.empresa_modulos_liberados ADD CONSTRAINT empresa_modulos_liberados_modulo_check
    CHECK (modulo IN ('assistencia','locacao','restaurante','petshop','clinica','obras','lavarapido','manufatura','hotelaria','sem_petshop'));
END $$;
