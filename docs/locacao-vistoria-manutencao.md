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

## Parte 2 — Plano de manutenção por equipamento (entregue)

Cada equipamento pode ter **planos de manutenção** (ex.: troca de óleo a cada 60 dias locados), em **Equipamentos › Manutenção**.

- **Contagem:** soma dos dias de locação (em andamento ou devolvida, do contrato ou dos itens) **depois da última manutenção do plano**. A locação em andamento conta até hoje. Uma locação que começou antes da manutenção só conta os dias depois dela.
- **Situação:** em dia; **vence em breve** quando faltam 20% do intervalo ou menos; **vencida** quando os dias locados chegam ao intervalo.
- **Avisa:** faixa de aviso nos Equipamentos e no Painel de locação, com os planos mais urgentes, e etiqueta "manutenção vencida" onde se escolhe o equipamento (nova locação e balcão).
- **Bloqueia:** plano vencido impede pôr a locação em andamento (entregar, balcão ou ajuste direto, a regra está no banco) até a manutenção ser registrada. Reserva futura pode existir; o que trava é a entrega.
- **Registrar manutenção** (`locacao_manutencao_registrar`): data, o que foi feito, custo, quem fez e o tipo. Preventiva do plano **recomeça a contagem**; corretiva (reparo de defeito) **tira o equipamento de "manutenção"** se ele não estiver fora de uso. O custo soma ao "custo de manutenção" do equipamento. Não se registra manutenção de equipamento locado.
- O registro **não se altera nem se apaga** (corrige-se com um novo registro). Plano pode ser editado (nome e intervalo) e desativado.
- Equipamentos com `quantidade` maior que 1: o plano é do cadastro inteiro. Para controlar cada unidade, cadastre cada uma como equipamento próprio.
