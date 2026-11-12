import { useEffect, useRef, useState } from "react";
import { aplicarEnderecoCep, consultarCep, normalizarCep, type EnderecoCep } from "@/lib/cep";

export function useConsultaCep<T extends EnderecoCep & { cep: string }>(
  dados: T,
  onChange: (dados: T) => void,
  ativo = true,
  cadastro?: string,
) {
  const atuais = useRef({ dados, onChange });
  atuais.current = { dados, onChange };
  const [situacao, setSituacao] = useState({ carregando: false, mensagem: "", erro: false });
  const cep = normalizarCep(dados.cep);

  useEffect(() => {
    setSituacao({ carregando: false, mensagem: "", erro: false });
    if (!ativo || cep.length !== 8) return;
    const controle = new AbortController();
    const tempo = setTimeout(async () => {
      const inicio = { ...atuais.current.dados };
      setSituacao({ carregando: true, mensagem: "Buscando endereço…", erro: false });
      try {
        const encontrado = await consultarCep(cep, controle.signal);
        if (controle.signal.aborted || normalizarCep(atuais.current.dados.cep) !== cep) return;
        atuais.current.onChange(aplicarEnderecoCep(atuais.current.dados, inicio, encontrado));
        setSituacao({ carregando: false, mensagem: encontrado.endereco ? "Endereço encontrado." : "Cidade e UF encontradas. Informe a rua e o bairro.", erro: false });
      } catch {
        if (controle.signal.aborted) return;
        setSituacao({ carregando: false, mensagem: "CEP não encontrado ou consulta indisponível. Confira o CEP ou preencha manualmente.", erro: true });
      }
    }, 400);
    return () => { clearTimeout(tempo); controle.abort(); };
  }, [cep, ativo, cadastro]);

  return situacao;
}