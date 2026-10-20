# Locação: vistoria na devolução e plano de manutenção

## Como era (análise)

- **Devolução:** `locacao_devolver` recalculava os dias reais e o valor, sem nenhuma conferência do equipamento. A tela devolvia com um clique, sem observação e com multa fixa em zero.
- **Dano:** não havia onde registrar nem como cobrar. A caução (`locacoes.caucao`) era só um número informado na locação: nada a abatia, devolvia ou cobrava.
- **Equipamento:** `locacao_equipamentos` tem situação (disponível, locado, manutenção) e um "custo de manutenção" fixo. Manutenção só mudava à mão, sem histórico, sem data e sem prazo.
- **Achados no caminho (fora do pedido):**
  - Em locação com vários equipamentos, a devolução só liberava o primeiro equipamento do contrato; os demais ficavam "locado" para sempre. A nova devolução libera todos.
  - Locação já faturada no balcão não cobra os dias a mais da devolução atrasada (o valor da locação sobe, o faturado não). Não mexido aqui; vale decidir se vira cobrança.
  - `quantidade` maior que 1 no equipamento o trata como estoque: se houver várias unidades que precisam de manutenção separada, cada uma deve ser cadastrada como equipamento próprio (com número de série).

## Parte 1 — Vistoria na devolução (entregue)

Devolver agora abre a **vistoria**: cada equipamento do contrato é conferido antes de a locação ser encerrada (`locacao_devolver_vistoriada`).

- Sem dano: registra a vistoria e o equipamento volta a ficar disponível (a não ser que outra locação em andamento o use).
- Com dano: o atendente informa cada avaria (descrição e valor) e pode marcar **perda total**, que sugere o valor de aquisição cadastrado (ajustável).
- **Cobrança:** o dano sai primeiro da **caução**; o que passar vira uma **conta a receber** do cliente (com o vencimento escolhido na devolução); o que sobrar da caução aparece como **caução a devolver**. O sistema não movimenta a caução no caixa: ela só é abatida no acerto e o valor a devolver fica registrado na locação (`caucao_abatida`, `caucao_devolver`).
- **Equipamento:** com dano vai para **manutenção** até o reparo ser registrado; perda total também o **tira de uso** (inativo).
- A vistoria **não se altera nem se apaga** depois de registrada (nem pelo dono do banco). A devolução antiga (sem vistoria) deixou de ser chamável.
- Locação devolvida tem o botão **Vistoria** para consultar o que foi registrado.

## Parte 2 — Plano de manutenção por equipamento (a fazer)

Decisões já tomadas: conta **dias de locação acumulados**; ao vencer, **avisa e bloqueia** nova locação até registrar a manutenção; ao registrar, a contagem recomeça.

- Cadastro do plano por equipamento: nome do plano (ex.: troca de óleo), intervalo em dias locados e se bloqueia ao vencer.
- Contagem: soma dos dias reais de cada locação devolvida desde a última manutenção do plano.
- Painel de locação e tela de equipamentos: equipamentos com manutenção vencida ou próxima de vencer.
- Registro da manutenção: data, o que foi feito, custo e quem fez; recomeça a contagem do plano, tira o equipamento de manutenção quando é um reparo de avaria e soma ao custo de manutenção do equipamento.
- Bloqueio: não se reserva nem se entrega equipamento com manutenção vencida (aviso claro na tela de nova locação).
