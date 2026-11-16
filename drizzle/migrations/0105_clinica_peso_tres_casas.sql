-- Peso do atendimento clínico passa a guardar 3 casas decimais (ex.: 12,345 kg); antes numeric(6,2) arredondava para 12,35.
-- Ampliar a escala não altera valores já gravados; o CHECK (> 0 e <= 200) continua valendo.
ALTER TABLE public.pet_atendimentos_clinicos ALTER COLUMN peso_kg TYPE numeric(6,3);
