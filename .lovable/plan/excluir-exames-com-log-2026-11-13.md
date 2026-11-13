# Excluir exames com log

## Resultado
Adicionar **Excluir exame** na tela Exames. A ação remove o exame do banco e das consultas do paciente, mantendo um log da exclusão — não será apenas um cancelamento.

## Confirmação e acesso
- Mostrar nome do pet, exame, data de coleta e situação antes da exclusão.
- Exigir motivo e confirmação explícita de exclusão definitiva.
- Manter a autorização clínica existente: apenas veterinário ativo da mesma empresa; somente o veterinário responsável pelo exame pode excluí-lo. A validação ocorre no banco, não apenas no botão.
- Permitir exclusão de exames abertos, fechados ou cancelados, com aviso adicional para laudos fechados e liberados ao tutor.

## Log e remoção
- Gravar, na mesma transação da exclusão, empresa, identificadores do paciente e exame, nome do exame, data de coleta, situação anterior, usuário, veterinário, data/hora e motivo.
- O log não depende de uma referência ao exame apagado e não pode ser editado ou removido pelos usuários.
- Remover os resultados, adendos e vínculos de anexos do exame, sem alterar outros exames, atendimentos ou modelos.
- Retirar o acesso do tutor aos laudos excluídos e impedir reutilização de links de anexos. Arquivos privados associados terão remoção controlada com reenvio em caso de falha, sem deixar o exame reaparecer.
- Atualizar lista de exames, prontuário, histórico e evolução após a exclusão; sair da ficha excluída.

## Detalhes técnicos
- Implementar uma função de banco autenticada, com autorização por empresa e veterinário, bloqueio do exame durante a operação e gravação atômica do log.
- As quatro proteções atuais impedem apagar exame, resultados, adendos e anexos. Acrescentar uma exceção restrita à operação autorizada de exclusão, sem liberar DELETE direto nem desativar as proteções globalmente.
- Tratar dependências entre resultados calculados, anexos e acessos, além das liberações do portal. Guardar a fila privada de limpeza dos arquivos antes de remover seus vínculos.
- Usar uma ação autenticada de servidor para limpeza dos arquivos privados, sem credenciais no navegador e com autorização previamente verificada.
- Adicionar a função à verificação de permissões da CI e manter os números dos outros exames sem arredondamento.

## Verificação
- Testar exclusão real de um exame criado exclusivamente para o teste e confirmar que desaparece ao recarregar a tela e consultar o banco.
- Confirmar que o log permanece com autor, horário e motivo.
- Testar recusa para outra empresa, outro veterinário, visitante sem sessão e tentativa de exclusão sem motivo.
- Testar resultados calculados, adendos, anexos e laudo liberado ao tutor; verificar que outros exames continuam intactos.
- Confirmar que falhas de limpeza de arquivo ficam registradas para nova tentativa.