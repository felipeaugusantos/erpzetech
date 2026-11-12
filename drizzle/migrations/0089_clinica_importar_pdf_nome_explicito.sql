DO $$
DECLARE d text;
BEGIN
 SELECT pg_get_functiondef('public.clinica_importar_pdf(uuid,uuid,jsonb)'::regprocedure) INTO d;
 d := replace(d, 'unidade text; nome text;', 'unidade text; v_nome text;');
 d := replace(d, 'lower(btrim(nome))=lower(btrim(g', 'lower(btrim(pet_exame_modelos.nome))=lower(btrim(g');
 d := replace(d, 'nome := btrim(it', 'v_nome := btrim(it');
 d := replace(d, 'IF nome IS NULL OR nome=', 'IF v_nome IS NULL OR v_nome=');
 d := replace(d, '=lower(nome)', '=lower(v_nome)');
 d := replace(d, ',nome;', ',v_nome;');
 d := replace(d, '''nome'',nome,', '''nome'',v_nome,');
 EXECUTE d;
END $$;