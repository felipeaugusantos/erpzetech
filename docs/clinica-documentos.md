# Clínica — receituário e documentos

O veterinário emite, pela consulta ou pela ficha do paciente: **receita simples**, **atestado**, **termo de consentimento** (anestesia, cirurgia, eutanásia, internação) e **solicitação de exames**. O documento sai em A4 (`/clinica-documento?id=…`) com os dados da clínica, do tutor, do pet e o CRMV da emissão.

## Regras
- Só o perfil **Veterinário** emite e lê; tabelas sem acesso direto, tudo por funções (`clinica_documento_*`). A leitura fica registrada em `clinica_acessos` (ação `documento`).
- **Imutável:** emitido não se altera nem se apaga. Erro se corrige cancelando (só quem emitiu, com motivo) e emitindo outro; o cancelado continua no registro e sai com a marca "CANCELADO".
- **Numeração** por empresa e ano (`0001/2026`), sem buracos de concorrência (trava por empresa e ano).
- **Receita de controle especial não é emitida:** exige receituário próprio e assinatura qualificada (Resolução CFMV 1.465/2022 e normas da Anvisa). A tela avisa e a função recusa medicamento marcado como controlado.
- **Sem assinatura digital:** imprime e assina de próprio punho. Assinatura ICP-Brasil e receita de controle especial ficam para uma fase própria (precisa de provedor de assinatura).
- **Modelos:** atestado e termo partem de modelos que acompanham o sistema (`MODELOS_INICIAIS`, com aviso para revisão jurídica); a clínica guarda os dela. O modelo guarda só o texto com marcadores (`{tutor}`, `{pet}`, `{especie}`, `{raca}`, `{data}`, `{veterinario}`, `{crmv}`, `{clinica}`), nunca dados do paciente.

## Fora desta entrega
- Trabalho sem internet (a emissão exige conexão).
- Assinatura digital e receita de controle especial.
- Envio do documento ao tutor (PDF por WhatsApp/e-mail).
