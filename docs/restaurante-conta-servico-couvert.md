# Restaurante: conta impressa, serviço opcional e couvert artístico

## Análise do que existia

- **Impressão:** só havia a etiqueta com código de barras (`Imprimir comanda`). Não havia conta impressa para o cliente conferir.
- **Serviço de 10%:** já era opcional no fechamento e na baixa parcial (chave "Serviço"), mas ligado por padrão e sem nada impresso mostrando a opção ao cliente.
- **Couvert:** campo "Couvert por pessoa" sempre aparecia ao abrir a comanda, mesmo em casa sem música ao vivo.

## O que mudou

1. **Imprimir conta** (80 mm, sem valor fiscal)
   - Na comanda: conta para conferência com _Total sem serviço_, _Serviço 10% (opcional)_ e _Total com serviço_ (e valor por pessoa, quando há mais de uma).
   - No fechamento: imprime conforme a decisão do cliente (serviço cobrado ou "não cobrado"), com desconto e valor já recebido em baixas parciais.
   - Mesma regra de cálculo e arredondamento do banco (`calcularConta`).
2. **Serviço opcional:** o texto no fechamento e na abertura deixa claro que é o cliente quem decide; o percentual continua definido na abertura da comanda.
3. **Show ao vivo:** nova opção em _Cadastro da empresa_ ("O estabelecimento tem show ao vivo", coluna `empresas.show_ao_vivo`, só administrador). Somente com ela ligada o campo de couvert aparece ao abrir a comanda; na conta ele sai como "Couvert artístico (pessoas × valor)". Sem a opção, o couvert é enviado como zero. Comandas já abertas com couvert continuam cobrando normalmente.

## Observações

- A opção é de tela: o banco continua aceitando couvert (a regra não bloqueia fila offline antiga).
- Aplicar a migration `20261018000000_empresa_show_ao_vivo.sql` no banco real; sem ela a opção não aparece e o couvert fica oculto.
