-- Restaurante com show ao vivo: só então a tela de abrir comanda mostra o couvert artístico.
ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS show_ao_vivo boolean NOT NULL DEFAULT false;
