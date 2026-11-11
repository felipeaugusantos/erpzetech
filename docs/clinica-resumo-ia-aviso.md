# Aviso de privacidade: resumo do histórico com IA (modelo para a clínica aprovar)

Texto para a clínica ler e autorizar **antes** de liberar o recurso (`CLINICA_IA_EMPRESAS_LIBERADAS`, ver `docs/clinica-resumo-ia.md`).
Não é parecer jurídico: pedir revisão de quem cuida da LGPD da EZRA, principalmente do trecho sobre a clínica ser a responsável pelos dados.
Antes de enviar, conferir nos termos do Lovable e do provedor de IA como os dados são tratados depois do envio (guarda, treino) e, se houver resposta clara, acrescentar um parágrafo. O texto abaixo não promete nada sobre isso.

---

**Aviso para a clínica: recurso "Resumir histórico" (IA)**

**O que é**
Um botão na ficha do paciente que, a pedido do veterinário, gera um resumo de leitura do histórico do animal. O resumo é só para consulta. Ele não é gravado no prontuário e não substitui a leitura do prontuário nem o julgamento do veterinário.

**O que a IA faz e não faz**

- Resume apenas o que já está escrito, com a data de cada fato.
- Não faz diagnóstico.
- Não sugere tratamento, medicamento, dose nem exame.
- Não interpreta resultados.
- Pode errar ou deixar algo de fora, por isso o veterinário deve conferir no prontuário.

**Que dados saem do sistema**
Para gerar o resumo, o texto clínico do animal é enviado a um serviço de IA, contratado por meio da plataforma Lovable.

- **Enviados:** espécie, raça, porte, sexo, pelagem, nascimento, peso, alergias e observações da ficha, e os dados dos atendimentos (até os 30 mais recentes): queixa, anamnese, sinais vitais, exame físico, diagnóstico, conduta, retorno, observações e adendos.
- **Não enviados:** nome do tutor, nome do animal, microchip, foto, telefone, nome e CRMV do veterinário.
- **Atenção:** se o veterinário escrever nomes, telefones ou outros dados pessoais no texto livre do prontuário, esse texto é enviado como está.

**Quem pode usar**
Somente veterinários da clínica, e só depois que a clínica autorizar. Cada uso fica registrado no acesso ao prontuário. O recurso nasce desligado e só liga com a autorização da clínica.

**Custos**
Cada resumo consome créditos de IA da plataforma.

**Como desligar**
A clínica pode pedir o desligamento a qualquer momento, e o botão deixa de aparecer. Nada gravado no prontuário é afetado.

**Autorização**
A clínica, como responsável pelos dados de seus pacientes e tutores, declara que leu este aviso e autoriza o uso do recurso.

Nome e cargo: ____________ Data: ____________ Assinatura: ____________
