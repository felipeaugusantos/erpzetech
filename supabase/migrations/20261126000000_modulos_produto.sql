-- Módulos: cada empresa tem um módulo principal (empresas.ramo_atividade) e o cadastro de produto muda conforme ele.
-- Módulos com cadastro próprio: construcao (Material de Construção), petshop (Pet Shop), clinica (Clínica Veterinária) e lavarapido (Lava-Rápido).
-- Os campos próprios ficam em produtos.dados_modulo (jsonb) e os campos comuns seguem nas colunas de sempre.
-- O banco confere as chaves e os valores aceitos, e a lista abaixo é a mesma de src/lib/modulos-produto.ts (um teste compara as duas).
-- A obrigatoriedade fica na tela, para não travar cadastros automáticos (nota de entrada, importação) que criam produtos sem formulário.
-- Outros ramos (roupas, autopeças, agro, restaurante…) seguem com o cadastro padrão e não guardam dados de módulo.

ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS dados_modulo jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.produtos DROP CONSTRAINT IF EXISTS produtos_dados_modulo_objeto;
ALTER TABLE public.produtos ADD CONSTRAINT produtos_dados_modulo_objeto
  CHECK (jsonb_typeof(dados_modulo) = 'object' AND pg_column_size(dados_modulo) <= 4000);
COMMENT ON COLUMN public.produtos.dados_modulo IS 'Campos do cadastro de produto próprios do módulo da empresa (ramo_atividade).';

-- Devolve a mensagem do primeiro problema, ou NULL se os dados estão corretos para o módulo.
CREATE OR REPLACE FUNCTION public._produto_dados_modulo_erro(p_ramo text, p_dados jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  v_cfg constant jsonb := '{
    "construcao": {"linha_aplicacao": "texto", "bitola_medida": "texto", "cor_acabamento": "texto",
                   "venda_fracionada": ["nao", "m", "m2", "m3", "kg"]},
    "petshop": {"especie": ["todas", "cao", "gato", "ave", "peixe", "roedor", "outras"],
                "porte": ["todos", "mini", "pequeno", "medio", "grande", "gigante"],
                "fase_vida": ["todas", "filhote", "adulto", "senior"],
                "sabor_linha": "texto", "peso_embalagem_kg": "numero", "registro_mapa": "texto"},
    "clinica": {"tipo": ["medicamento", "vacina", "material", "alimento_clinico"], "principio_ativo": "texto",
                "concentracao_forma": "texto",
                "via_administracao": ["oral", "injetavel", "topica", "oftalmica", "otologica", "outra"],
                "registro_mapa": "texto", "controlado": "booleano",
                "conservacao": ["ambiente", "refrigerado", "congelado"]},
    "lavarapido": {"tipo": ["insumo", "revenda"], "rendimento_lavagens": "numero", "perigoso": "booleano"}
  }'::jsonb;
  v_campos jsonb;
  k text;
  v jsonb;
  esp jsonb;
BEGIN
  IF p_dados IS NULL OR p_dados = '{}'::jsonb THEN RETURN NULL; END IF;
  v_campos := v_cfg -> coalesce(p_ramo, 'construcao');
  IF v_campos IS NULL THEN RETURN 'O módulo desta empresa não tem campos próprios de produto'; END IF;
  FOR k, v IN SELECT key, value FROM jsonb_each(p_dados) LOOP
    esp := v_campos -> k;
    IF esp IS NULL THEN RETURN format('O campo "%s" não existe no cadastro deste módulo', k); END IF;
    IF jsonb_typeof(esp) = 'array' THEN
      IF jsonb_typeof(v) <> 'string' OR NOT ((v #>> '{}') IN (SELECT jsonb_array_elements_text(esp))) THEN RETURN format('Valor inválido em "%s"', k); END IF;
    ELSIF esp = '"texto"'::jsonb THEN
      IF jsonb_typeof(v) <> 'string' OR length(v #>> '{}') > 120 THEN RETURN format('O campo "%s" aceita texto de até 120 caracteres', k); END IF;
    ELSIF esp = '"numero"'::jsonb THEN
      IF jsonb_typeof(v) <> 'number' OR (v #>> '{}')::numeric < 0 THEN RETURN format('O campo "%s" aceita um número maior ou igual a zero', k); END IF;
    ELSIF esp = '"booleano"'::jsonb THEN
      IF jsonb_typeof(v) <> 'boolean' THEN RETURN format('O campo "%s" aceita sim ou não', k); END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public._produto_dados_modulo_erro(text, jsonb) FROM PUBLIC, anon, authenticated;

-- Confere os dados do módulo quando eles são informados ou mudam. Atualizar o produto sem mexer neles não é barrado.
CREATE OR REPLACE FUNCTION public._produto_dados_modulo_guarda()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_ramo text;
  v_erro text;
BEGIN
  IF NEW.dados_modulo = '{}'::jsonb THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.dados_modulo IS NOT DISTINCT FROM OLD.dados_modulo THEN RETURN NEW; END IF;
  SELECT e.ramo_atividade INTO v_ramo FROM public.empresas e WHERE e.tenant_id = NEW.tenant_id ORDER BY e.created_at, e.id LIMIT 1;
  v_erro := public._produto_dados_modulo_erro(v_ramo, NEW.dados_modulo);
  IF v_erro IS NOT NULL THEN RAISE EXCEPTION '%', v_erro; END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public._produto_dados_modulo_guarda() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_produto_dados_modulo ON public.produtos;
CREATE TRIGGER trg_produto_dados_modulo BEFORE INSERT OR UPDATE OF dados_modulo ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public._produto_dados_modulo_guarda();

-- O módulo Lava-Rápido também fica liberado quando é o módulo principal da empresa (ramo_atividade = lavarapido).
-- Mesma regra de src/lib/cnae-regras.ts: o módulo principal, a liberação explícita, a escolha sem CNPJ ou o CNAE 45.20-0/06.
CREATE OR REPLACE FUNCTION public.lava_rapido_liberado() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $fn$
 SELECT EXISTS (SELECT 1 FROM public.empresas e WHERE e.tenant_id = public.current_tenant_id() AND (
 e.ramo_atividade = 'lavarapido'
 OR EXISTS (SELECT 1 FROM public.empresa_modulos_liberados m WHERE m.empresa_id = e.id AND m.modulo = 'lavarapido')
 OR (length(regexp_replace(coalesce(e.cnpj,''), '[^0-9A-Za-z]','','g')) < 14 AND 'lavarapido' = ANY(e.modulos_sem_cnpj))
 OR EXISTS (SELECT 1 FROM unnest(regexp_split_to_array(coalesce(e.cnae,'') || ',' || coalesce(e.cnae_secundarios,''), '[,;\n|]+')) c WHERE regexp_replace(c,'\D','','g') LIKE '4520006%')))
$fn$;
REVOKE ALL ON FUNCTION public.lava_rapido_liberado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lava_rapido_liberado() TO authenticated;
