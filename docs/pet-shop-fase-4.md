# Módulo Pet shop — Fase 4 (clínica: exames, lembretes e trabalho sem internet)

Continuação de `docs/pet-shop-fase-3.md`. Da Fase 3, a base da clínica, o prontuário, as vacinas e os reforços estão na `main`. Falta dela a **cobrança clínica (PR 5)**, que espera o contador (tratamento fiscal da vacina) e segue como está.

## De onde vem

Pedidos do cliente, com fotos das telas do sistema que ele usa hoje (hemograma, bioquímica sanguínea e exame de urina):

1. **Sem internet:** salvar cadastros quando não há sinal, por exemplo ao levar o notebook a uma propriedade rural.
2. **Lembrete de vacina** para 21 dias, 30 dias ou reforço anual.
3. **Exames:** espaço para anexar exames de imagem (ultrassom, raio-x) e de sangue, e **preencher os valores só com número**, sem digitar o hemograma e os bioquímicos.

## Decisões em aberto

O PR 1 não depende de nenhuma delas. A decisão 4 trava o PR 2 (e, por consequência, os PRs 3 e 4); as decisões 2 e 3 travam o PR 5; a decisão 1 pode abrir uma fase própria; a 5 só acrescenta modelos.

| #   | Pergunta                                                                                              | Sugestão                                                                            | Estado                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | A visita à propriedade rural é para cães e gatos, ou também bovinos, equinos e outros?                | Se for grande porte, vira fase própria (seção 7); em cães e gatos nada muda         | **Aberta**                                                                                              |
| 2   | O modo sem internet cobre só cadastros, ou também atendimento clínico, vacina e exame?                | Tudo, com os dados criptografados no notebook (seção 6)                             | **Aberta**                                                                                              |
| 3   | A ordem: lembrete, exames, depois offline — ou o offline primeiro por causa da viagem?                | Lembrete, exames, offline; se a viagem for antes, o offline sobe                    | **Aberta**                                                                                              |
| 4   | As unidades da bioquímica seguem as do laboratório da clínica? (as telas de hoje não mostram unidade) | Cada clínica ajusta unidade e faixa no próprio modelo; o sistema só traz sugestões  | **Respondida em parte:** o laudo de exemplo sugere as unidades usuais (seção abaixo); a clínica confere |
| 5   | Há outras fichas no sistema atual que a clínica usa (a tela cita "Autorização Sacrifício")?           | Mandar as telas; cada ficha nova entra como modelo de documento, fora do prontuário | **Aberta**                                                                                              |

## Ordem das entregas

| PR  | Entrega                                                                                                                  | Depende de     |
| --- | ------------------------------------------------------------------------------------------------------------------------ | -------------- |
| 1   | **Atalhos da próxima dose:** botões "21 dias", "30 dias" e "1 ano" ao registrar a vacina                                 | nada           |
| 2   | **Exames — modelos:** hemograma, bioquímica e urina como modelos editáveis, com unidade e faixa por espécie              | decisão 4      |
| 3   | **Exames — resultados:** preencher só com número, cálculo do hemograma, valor fora da faixa e evolução; laudo imprimível | PR 2           |
| 4   | **Exames — anexos:** ultrassom, raio-x e laudos em arquivo, no atendimento                                               | PR 2           |
| 5   | **Trabalho sem internet:** fila segura de cadastros, atendimento, vacina e exame, enviada ao reconectar                  | decisões 2 e 3 |
| —   | Cobrança clínica (PR 5 da Fase 3)                                                                                        | contador       |

## PR 1 — Atalhos da próxima dose (entregue)

- Hoje a próxima dose já sai do catálogo (intervalo entre doses da série e intervalo de reforço, editáveis: 21, 30 ou 365 dias). A lista **Reforços de vacina** já mostra o que vence e o que atrasou.
- O que falta é trocar o prazo na hora: ao lado da data da próxima dose, botões **"21 dias"**, **"30 dias"** e **"1 ano"**, que preenchem a data a partir do dia da aplicação. Sem mudar o catálogo nem o banco: usa o campo `proxima_dose_em` que a aplicação já aceita.
- Vale também para vacina aplicada em outro local (o diálogo ganhou o campo "Próxima dose" com os mesmos atalhos).
- **Entregue.** Sem migração: só a tela e a função `dataDoAtalho` (1 ano em 29/02 cai em 28/02).

## Campos de referência: modelo de laudo de laboratório

O cliente enviou um laudo de laboratório só como **ideia dos campos** que o sistema deve ter para o veterinário preencher. Nada dele é importado: o sistema não lê PDF, e os dados do laudo (paciente, laboratório, valores) não entram no sistema nem no repositório. O que ele sugere para os modelos:

- **Cabeçalho do exame:** paciente, idade, sexo, raça, responsável, data da coleta, veterinário solicitante (nome e CRMV) e **material** (sangue total em EDTA, soro, urina e outros, em lista editável).
- **Hemograma em três grupos:** eritrograma (hemácias, hemoglobina, hematócrito, **VCM, HCM, CHCM e RDW**), leucograma e plaquetograma. O VCM, o HCM, o CHCM e o RDW não existem nas telas do sistema atual e entram no modelo.
- **Leucograma:** para cada célula, valor **relativo (%)**, valor **absoluto** e faixa dos dois. O absoluto é calculado a partir dos leucócitos totais e do percentual, e o diferencial precisa somar 100% (como previsto no PR 3). No modelo, cada célula do diferencial tem **dois campos ligados**: o percentual (digitado) e o absoluto (**calculado**, forma de valor "calculado" a partir dos leucócitos totais). Os dois têm faixa própria em `pet_exame_referencias`, e o fechamento do exame guarda o nome, a unidade e a faixa dos dois.
- **Observação por grupo ou campo:** o plaquetograma, por exemplo, precisa de um texto livre para registrar achados que afetam a leitura (como agregados plaquetários).
- **Bioquímica um exame por vez:** cada campo com valor, unidade, faixa e **nota técnica** opcional (texto livre). Unidades usuais: U/L (enzimas), mg/dL (creatinina, ureia), g/dL (albumina, proteínas).

O que muda no desenho:

1. **Faixa de referência é do exame:** o veterinário pode ajustar a faixa ao preencher, e ela é guardada junto com o resultado, como já previsto para o exame fechado. A faixa do modelo é só sugestão.
2. **Exame trazido de fora** é o "avulso" do PR 3, preenchido pelo veterinário, com a data da coleta e o nome do laboratório em texto livre.
3. **Nota técnica e observação** são texto livre do resultado e entram no laudo impresso pela clínica quando preenchidas.
4. **Material** é um campo do exame, em lista editável.
5. O **laudo impresso pela clínica** (PR 3) segue esse formato: cabeçalho do paciente, grupos, valor, unidade, faixa e observações, com o destaque de valor fora da faixa.

## PR 2 — Exames: modelos

As telas de hoje definem os modelos iniciais (campos na ordem da tela):

- **Hemograma:** hemácias (milhões/mm³), hemoglobina (g%), hematócrito (%), **VCM (fl), HCM (pg), CHCM (%), RDW (%)** (sugeridos pelo laudo de exemplo), proteínas totais (g%), plaquetas (mil/mm³), leucócitos totais (células/mm³); diferencial em %: metamielócitos, bastonetes, segmentados, eosinófilos, basófilos, linfócitos, monócitos; observações.
- **Bioquímica sanguínea (21 itens):** albumina, proteínas totais, globulinas, fibrinogênio, bilirrubina total, bilirrubina direta, AST (TGO), ALT (TGP), fosfatase alcalina, ureia, creatinina, glicose, colesterol, amilase, lipase, cálcio, fósforo, sódio, potássio, ácido úrico, creatinoquinase; observações.
- **Urina:** físico (volume em ml, colheita, aspecto, cor, odor, densidade, pH), químico (proteínas e glicose em mg%, corpos cetônicos, bilirrubina, urobilinogênio, sangue oculto, nitritos), sedimentoscopia (hemácias, leucócitos, cilindros, células descamativas, cristais, outros); observações.

Desenho:

- **Modelo** (`pet_exame_modelos`): nome, tipo (hemograma, bioquímica, urina, outro), ativo. **Campo** (`pet_exame_campos`): ordem, grupo, nome, unidade, forma de valor (**número**, **texto** ou **escolha** com opções), casas decimais, observação. O veterinário e a gestão incluem, tiram e reordenam campos; modelo já usado em exame fechado não perde campo (fica inativo).
- **Faixa de referência** (`pet_exame_referencias`): mínimo e máximo por campo e por espécie (cão, gato e **outro**, para os pets já cadastrados nessa categoria; sem faixa, nada é destacado). **As faixas vêm como sugestão marcada para o veterinário conferir**, como no catálogo de vacinas: o sistema não decide valor clínico, e cada clínica ajusta ao seu laboratório e método.
- Cada tela acima vira o modelo correspondente já cadastrado, para a clínica começar sem montar nada.
- O laudo de exemplo (seção anterior) acrescenta ao hemograma **VCM, HCM, CHCM e RDW**, separa o **plaquetograma** (com observação própria) e mostra que a bioquímica chega **um exame por vez**, cada um com unidade, faixa e nota técnica.
- **Exame fechado guarda o que viu:** ao fechar, o resultado grava junto, para cada campo, o nome, a unidade, as casas decimais e a faixa de referência em vigor. Editar o modelo depois muda só os exames futuros; laudo e evolução de exame fechado leem esse registro, nunca o modelo atual.
- Acesso: o mesmo desenho do prontuário (seção "Regras que valem para tudo"). Sem acesso direto às tabelas, funções que exigem a clínica liberada (`clinica_liberada`). **Manter modelo e faixa** (configuração) é do administrador, do gestor e do Veterinário, como o catálogo de vacinas; **escrever resultado** é só do Veterinário.

## PR 3 — Exames: resultados

- **Número onde o campo é número.** A tela mostra o modelo com a unidade ao lado de cada campo; os campos de forma **número** têm teclado numérico (vírgula ou ponto) e só aceitam número, e os de **texto** (colheita, aspecto, cor, odor, cristais, observações) e **escolha** aparecem como texto livre ou lista. O hemograma e a bioquímica são quase todos numéricos.
- **Campo em branco é "não feito".** Diferente das telas de hoje, que iniciam em 0,000: aqui o zero precisa ser digitado, e exame que não foi pedido não aparece como valor zero.
- **Hemograma:** com os leucócitos totais e os percentuais do diferencial, o sistema calcula os **valores absolutos** de cada célula e confere se o diferencial soma 100%.
- **Valor fora da faixa** de referência da espécie fica destacado (abaixo ou acima), com a faixa à vista. Sem faixa cadastrada, não destaca nada.
- **Evolução:** o mesmo valor ao longo dos exames do pet (lista com datas e, no mínimo, seta de subiu/desceu).
- **Vínculo:** o exame pode estar ligado a um atendimento clínico aberto ou ser **avulso** do paciente (resultado de laboratório externo, com a data da coleta e o nome do laboratório).
- **Fechar o exame o torna imutável**, como o atendimento; correção é **adendo** com nome e CRMV. Nada se apaga.
- **Laudo imprimível:** só para o veterinário e o tutor (entrega em papel), com valores, unidades e faixas; sem texto do prontuário.
- Auditoria de quem abriu o exame, como no prontuário.

## PR 4 — Exames: anexos

- Arquivos de **ultrassom, raio-x e laudos** ligados ao atendimento ou ao exame: imagem (JPEG, PNG) e PDF. Limite de tamanho por arquivo e por exame definido no PR (proposta: 15 MB por arquivo).
- **Armazenamento privado** (nada de endereço público): o arquivo só abre por um link temporário que o sistema gera depois de conferir o perfil Veterinário e a clínica liberada. Reaproveita o mecanismo de armazenamento já usado para foto de produto e de entrega, com um espaço próprio e fechado.
- Anexo é **imutável**: não se troca nem se apaga; enviado por engano vira **anexo cancelado, com motivo**, que some da visualização normal e continua no registro.
- Auditoria de quem enviou e de quem abriu. DICOM (formato de aparelho de imagem) fica de fora desta fase: o veterinário exporta imagem ou PDF.
- Vale a decisão 2: no modo sem internet o arquivo fica guardado no notebook (PR 5) e sobe ao reconectar.

## PR 5 — Trabalho sem internet

Hoje o sistema tem fila sem internet para frente de caixa, salão, delivery e conferência (operações guardadas no navegador e enviadas por uma rotina que aceita repetição), e guarda cópia de telas para consulta. Cadastro, atendimento clínico, vacina e exame ainda não funcionam assim. O desenho:

- **Fila única** no navegador para as gravações da clínica e dos cadastros. Cada operação carrega uma **chave de repetição**; ao reconectar, o envio é idempotente (repetir não duplica). **Operação recusada pelo banco fica guardada com o erro e nunca é descartada sozinha**, como já é a regra do sistema.
- **Consulta sem internet:** cópia do que a visita precisa (tutores e pets do dia, catálogo de vacinas, modelos de exame, lotes com saldo) baixada antes de sair e mostrada com a data da cópia.
- **Etapas:**
  - **5a — cadastros:** tutor, pet e (se a decisão 1 pedir) propriedade.
  - **5b — atendimento, vacina e exame:** preenchimento completo sem sinal; fechar também fica na fila.
  - **5c — anexos:** fotos e PDFs guardados no notebook até subir.
- **Dado clínico no notebook é sensível** (LGPD): fica no armazenamento do navegador com **criptografia** protegida por senha da pessoa que está usando (o dado não abre sem ela), expira se o aparelho ficar sem entrar por um prazo definido (só a **cópia de consulta** expira; a **fila de gravações pendentes** nunca expira sozinha, e a operação recusada fica guardada até ser enviada ou resolvida por uma pessoa) e some depois de enviado. Se o notebook for perdido, sem a senha o conteúdo não abre. Isso exige uma estrutura nova (a cópia atual usa o armazenamento simples do navegador e não serve para dado clínico).
- **Conflitos conhecidos e a regra para cada um:**
  - **Baixa de lote da vacina:** a dose só é baixada ao sincronizar. Se o lote acabou antes, o registro **fica pendente com o erro** e o veterinário escolhe outro lote; nada é perdido.
  - **Prontuário fechado sem internet:** o fechamento vale quando sincroniza; edição concorrente do mesmo atendimento por outro aparelho é recusada e fica guardada.
  - **Cadastro duplicado** (o mesmo tutor cadastrado em dois aparelhos): o envio avisa e a recepção une, sem apagar nada.

## Regras que valem para a fase inteira

- **Só o veterinário lê e escreve** o resultado de exame, o anexo e o texto clínico. Administrador e gestor mantêm modelos e faixas (configuração), mas não leem resultado. Recepção só sabe que o exame existe, se precisar para a cobrança.
- **Sem acesso direto às tabelas** nem para quem mantém o modelo: tudo passa por funções que exigem a clínica liberada (CNAE 7500 ou ramo "Clínica veterinária") e o perfil certo.
- **Nada clínico é apagado nem reescrito:** fechar é definitivo, correção é adendo, cancelamento tem motivo.
- **Faixa de referência e protocolo são do veterinário**, nunca do sistema: tudo o que vem pré-preenchido é sugestão marcada.
- **Dado sensível no aparelho** só com criptografia e senha (PR 5).

## Fora do escopo desta fase

- **Animais de grande porte e propriedades rurais** (bovinos, equinos e outros): depende da decisão 1 e seria uma **Fase 5** própria (cadastro de propriedade e de rebanho, espécies novas, preço por espécie, atendimento no local).
- Receituário e medicamento controlado, internação, cirurgia, telemedicina, assinatura digital de documentos.
- Envio automático de lembretes (depende da integração oficial com o WhatsApp).
- Cobrança clínica (PR 5 da Fase 3), enquanto o contador não responder o tratamento fiscal da vacina.
