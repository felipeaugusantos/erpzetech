-- Achado da revisão do PR da base da NFC-e: o emitente da nota usa o CNPJ, a inscrição estadual e o endereço da filial
-- do pedido quando a filial os tem, e o da empresa só como reserva. Vale também para a conferência das pendências.
DO $$
DECLARE
  def text;
  novo text;
  campo text;
BEGIN
  def := pg_get_functiondef('public.nfce_criar(uuid, text)'::regprocedure);
  novo := def;

  novo := replace(novo,
    $q$IF coalesce(v_emp.cnpj, '') = '' OR coalesce(v_emp.inscricao_estadual, '') = '' THEN$q$,
    $q$IF coalesce(nullif(v_fil.cnpj, ''), v_emp.cnpj, '') = ''
       OR coalesce(nullif(v_fil.inscricao_estadual, ''), v_emp.inscricao_estadual, '') = '' THEN$q$);
  novo := replace(novo,
    $q$IF coalesce(v_emp.estado, '') = '' THEN$q$,
    $q$IF coalesce(nullif(v_fil.estado, ''), v_emp.estado, '') = '' THEN$q$);

  IF novo = def THEN RAISE EXCEPTION 'Não foi possível ajustar as pendências de nfce_criar'; END IF;
  def := novo;

  FOREACH campo IN ARRAY ARRAY['cnpj', 'inscricao_estadual', 'endereco', 'numero', 'bairro', 'cidade', 'estado', 'cep'] LOOP
    novo := replace(novo, format('''%s'', v_emp.%s', campo, campo),
                    format('''%s'', coalesce(nullif(v_fil.%s, ''''), v_emp.%s)', campo, campo, campo));
  END LOOP;
  IF novo = def THEN RAISE EXCEPTION 'Não foi possível ajustar o emitente de nfce_criar'; END IF;

  EXECUTE novo;
END $$;
