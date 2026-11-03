# SNGPC para medicamentos controlados de uso veterinário

Escrituração dos medicamentos de controle especial (Portaria SVS/MS 344/98) usados ou dispensados pela clínica, e geração dos arquivos XML do SNGPC. Fica no grupo **Clínica**, em `/sngpc`.

## De onde vem

Lista de requisitos de um sistema concorrente: "Cadastro do responsável pelo envio do SNGPC (farmacêutico)" e "Módulo Geração do SNGPC: para medicamentos controlados de uso veterinário". O cadastro do farmacêutico (com CRF) já estava entregue; esta fase acrescenta o CPF dele (o XML exige) e o módulo em si.

## Fonte do layout

O layout vem do **Guia para geração do padrão de transmissão SNGPC, versão 2.3 (Anvisa, setembro de 2025)**, que traz os exemplos de XML de movimentação e de inventário e os tipos enumerados. O que o guia confirma e o módulo usa:

- raiz `mensagemSNGPC` (movimentação) e `mensagemSNGPCInventario`, namespace `urn:sngpc-schema`, codificação `iso-8859-1`;
- cabeçalho com `cnpjEmissor`, `cpfTransmissor` (CPF do responsável técnico), `dataInicio`/`dataFim` (inventário: `data`, até 7 dias antes da transmissão);
- operações usadas: `entradaMedicamentos` (com nota fiscal), `saidaMedicamentoVendaAoConsumidor` (dispensação por receita), `saidaMedicamentoPerda`;
- **uso veterinário**: `usoMedicamento` = 2 e, no prescritor, **somente o conselho CRMV**;
- classe terapêutica 2 (sujeito a controle especial): dados do **comprador obrigatórios**, dados do paciente não;
- tipos de receituário 1 a 4 (o 5 é de antimicrobiano humano e não é usado); motivos de perda 1 a 9; unidade de medida 1 (caixas) e 2 (frascos);
- quantidade de venda limitada a 3 dígitos (999);
- o arquivo vai **compactado em .zip** e é transmitido pelo webservice da Anvisa ou pelo portal.

## O que o módulo faz

1. **Medicamentos controlados:** liga um produto do cadastro ao registro na Anvisa (13 dígitos), à lista da Portaria 344 (A1, A2, A3, B1, B2, C1 a C5) e à unidade (caixa ou frasco).
2. **Livro (escrituração):** lançamentos de saldo inicial, entrada (nota fiscal de compra), dispensação (receita ou notificação, prescritor CRMV, tutor, animal) e perda (motivo). O saldo é por medicamento e lote; **nenhum lançamento pode deixar o saldo de um lote negativo em nenhuma data**. Lançamento não se apaga: cancela-se com motivo, e só fora de período já transmitido.
3. **Envios:** o responsável técnico escolhe o período, o sistema monta o XML, mostra a conferência, baixa o `.zip` e guarda uma cópia do que foi gerado. Depois do envio ao SNGPC, registra-se o protocolo e o período fica fechado. Há também o XML de inventário (saldo numa data).

## Decisões

- **O livro é próprio.** A escrituração do SNGPC não baixa o estoque comum do ERP: o controlado exige livro e lote próprios, e misturar os dois faria um erro de estoque virar erro sanitário. Ligar as duas coisas (dispensar no caixa e escriturar junto) fica para uma etapa seguinte, com o responsável técnico.
- **A receita de controle especial continua sem emissão** no sistema (`docs/clinica-documentos.md`): ela exige receituário próprio e assinatura qualificada. O módulo só **escritura** a receita física que o tutor trouxe.
- **O envio é manual.** O sistema gera e guarda o arquivo; quem transmite é o responsável técnico, no portal ou pelo webservice da Anvisa. Transmitir pela API é uma etapa futura.
- **Quem opera:** administrador, gestor e veterinário. O farmacêutico não precisa ter acesso ao sistema; ele é um cadastro (CRF e CPF) escolhido ao gerar o arquivo.

## O que ainda precisa de confirmação (não decidir por palpite)

| #   | Ponto                                                                                                                                                                         | Como está hoje                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | **A clínica pode e precisa enviar ao SNGPC?** O guia é para farmácias e drogarias. A obrigação de uma clínica depende de dispensar controlados e do estabelecimento estar cadastrado no SNGPC. | Confirmar com o responsável técnico e a vigilância sanitária local antes de usar em produção.   |
| 2   | **Validação contra o XSD oficial.** O XSD não estava disponível aqui; o XML segue o exemplo do guia (nomes e ordem dos elementos).                                            | Validar cada arquivo no validador da Anvisa antes do primeiro envio real.                        |
| 3   | **Tipo de documento do comprador (`tipoDocumento`).** O guia não lista os códigos.                                                                                            | Só o valor 1 do exemplo (documento de identidade com órgão expedidor e UF) é aceito.             |
| 4   | **Tamanho do número da notificação** e **elementos opcionais** (`usoProlongado` vazio, `cid` vazio, ausência de `insumos`).                                                    | Seguem o exemplo do guia; o validador da Anvisa confirma.                                        |
| 5   | **Nome do arquivo e prazo de envio** do `.zip`.                                                                                                                               | Nome livre sugerido; confirmar o prazo no manual do desenvolvedor.                               |
| 6   | **Transferência entre estabelecimentos e transformação** (manipulação).                                                                                                       | Fora do módulo: transferência não é usada pela clínica; transformação é só de farmácia de manipulação. |
| 7   | **Antimicrobianos** (classe 1) e insumos.                                                                                                                                     | Fora: o módulo cobre só medicamentos de controle especial (classe 2).                            |

## Modelo de dados

`sngpc_medicamentos` (cadastro), `sngpc_documentos` (cabeçalho do lançamento) e `sngpc_itens` (medicamento, lote, quantidade), `sngpc_envios` (arquivo gerado, período, protocolo). Tabelas sem leitura nem escrita direta; tudo por funções (`sngpc_*`), com perfil, clínica liberada e registro de quem lançou. Lançamento e item não se alteram nem se apagam.
