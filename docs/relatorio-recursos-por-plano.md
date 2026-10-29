# Relatório: recursos por plano e segmento (EZRA ERP)

Base: `main` em `311f2ee`. Nada foi commitado, enviado ou publicado. Não houve alteração de permissões, RLS, feature flags, billing, assinaturas, banco ou dados.

## 1. Recursos liberados hoje

**O plano não libera nem bloqueia recurso nenhum.** O plano (`balcao`, `loja`, `rede`) só define preço, prazo, dias de teste, valor de filial extra e implantação (`saas_planos`); a lista `recursos` é texto de apresentação. Nenhum menu, tela, RLS ou função do banco consulta o plano para liberar módulo.

O que libera módulo é a empresa:
- `moduloLiberadoEmpresa` (`src/lib/cnae-regras.ts`): liberação explícita (`empresa_modulos_liberados`), escolha em "Módulos sem CNPJ" (só sem CNPJ de 14 dígitos), ramo de atividade ou CNAE.
- Pet shop é liberado também quando a clínica está liberada.
- Clínica: só CNAE 7500 ou ramo clínica. Lava-rápido: CNAE 4520006 ou ramo lavarapido.
- O grupo "Clínica" do menu ainda depende do perfil (veterinário, gestão, recepção).

### Telas existentes por módulo (menu atual)
| Módulo | Telas |
|---|---|
| Pet shop | Agenda, Pets e tutores, Serviços e preços, Profissionais, Contatos, Pacotes, Comissões; relatório de serviços por profissional |
| Clínica | Prontuário, Exames, Modelos de exame, Catálogo de vacinas, Reforços de vacina, Trabalho sem internet da clínica |
| Lava-rápido | Pátio, Veículos, Serviços e preços, Planos e fidelidade, Administrar planos e brindes, Clientes e fidelidade, Insumos, Lavadores e comissões, Avisos ao cliente, WhatsApp automático |

## 2. Tabela proposta por segmento e plano, com o que o código sustenta

Legenda: **Existe** = tela/recurso existe; **Sem trava** = hoje aparece em qualquer plano; **Divergência** = a proposta não corresponde ao código.

| Segmento | Essencial (proposto) | Profissional (proposto) | Situação no código |
|---|---|---|---|
| Pet shop | Agenda, pets e tutores, serviços e preços, contatos, cadastro de profissionais | + Pacotes, comissões | Tudo existe, sem trava por plano. Pacotes e Comissões são telas separadas (viável de separar no futuro). |
| Clínica | Prontuário, exames e modelos, catálogo de vacinas e reforços | + "gestão financeira" | Itens do Essencial existem. **Não existe recurso financeiro próprio da clínica**; só o Financeiro comum a qualquer empresa. |
| Lava-rápido | Pátio, veículos, clientes, serviços e preços, cadastro de lavadores | + Insumos, comissões, planos de serviços, fidelidade, brindes | Tudo existe, sem trava. **"Lavadores e comissões" é uma tela só**, e "Clientes e fidelidade" mistura cadastro de clientes com fidelidade. |
| Empresarial | Tudo do Profissional + 2 empresas com 1 filial cada, usuários ilimitados | | Regra comercial confirmada; usuários e empresas não são conferidos por código aqui. |

### Clínica: dependência de agenda e pets/tutores
- A consulta nasce de um agendamento do pet shop (`clinica_atendimento.agendamento_id` obrigatório, único, referencia `pet_agendamentos`; o agendamento precisa ter serviço de consulta) e usa `pets` e `clientes`.
- Esses cadastros e a agenda existem na área Pet shop, que o sistema libera automaticamente quando a clínica está liberada. Por isso a clínica já tem agenda e pets/tutores hoje, mas **dentro do módulo Pet shop**, não no menu "Clínica". A copy diz só "Consulta aberta a partir da agenda, com pet e tutor cadastrados".

### Trabalho sem internet (operações cobertas)
- Frente de caixa (`frente-caixa`), PDV do restaurante (`salao`), `delivery`, conferência (`conferencia-offline`), lotes (`lotes-offline`) e clínica (`clinica-offline`: atendimentos, exames, vacinas, anexos e cadastro rápido de paciente).
- Pet shop e Lava-rápido: não encontrei fila offline (`lava-avisos` e `lava-whatsapp` citam o termo, mas não são a fila de operações).
- Nada anunciado por plano. A copy pública fica restrita a "Vende sem internet".

## 3. Divergências técnicas e comerciais

1. **Distribuição por plano não é aplicada pelo sistema.** Por isso a copy não afirma "Pacotes só no Profissional" e similares. Aplicar exigiria feature flags/RLS/permissões, fora deste escopo.
2. **Taxa de R$ 299 (resolvida na migration `20261201000000_taxa_inicial_segmento.sql`, ainda não aplicada):** `taxa_inicial_segmento(ramo)` devolve R$ 299 e o rótulo "Treinamento e configuração inicial" para `petshop`, `clinica` e `lavarapido` (ramo de atividade da empresa; o pet shop entrou na migration `20261202000000_taxa_inicial_petshop.sql`). `assinatura_taxa_inicial()` alimenta a tela `/planos` e `saas_taxa_inicial_cliente(cliente)` (só operador) sugere o valor na nova cobrança do tipo Implantação. Nada é gravado: `assinaturas.valor_implantacao`, `saas_planos.valor_implantacao`, a implantação de filial/empresa adicional e as mensalidades não mudam. A cobrança continua manual: a equipe confere e pode editar o valor sugerido. Limites: a regra usa só o ramo de atividade (CNAE ou liberação explícita sem o ramo não contam) e o valor fica no SQL (mudar exige nova migration).
3. **"Sem adicional pelo módulo individual"** é coerente com o banco (não há preço por módulo, só plano, implantação e filial extra), mas é decisão comercial a confirmar.
4. **Clínica: "gestão financeira" não existe como recurso clínico.** Não foi anunciada.
5. **Lava-rápido: cadastro e comissões de lavadores na mesma tela**, então a separação Essencial/Profissional exigiria dividir a tela.
6. **Fiscal:** a página pública ainda tem um cartão "NF-e e NFS-e" com "download em PDF e XML" e o plano Profissional lista "NF-e". Não alterei, mas a cobertura fiscal por plano, segmento e município não está validada. Não confundir NF-e com NFS-e nem prometer cobertura universal.
7. **Corrigido na marca (escape da troca anterior):** duas mensagens pré-preenchidas do WhatsApp, codificadas na URL, ainda diziam "ERP Ze Tech" (`index.tsx`, `funcionalidades.tsx`). Mudou só o texto; número e domínio preservados.

## 4. Decisões pendentes
- Taxa inicial do Pet shop: decidida em R$ 299, como clínica e lava-rápido (migration `20261202000000_taxa_inicial_petshop.sql`).
- Uso de Pet shop e Clínica na mesma empresa, e de mais de um módulo (sem pacote nem preço; a copy remete à equipe).
- Confirmar o texto "incluídos na mensalidade, sem adicional pelo módulo".
- Conteúdo, duração e formato do treinamento de R$ 299 (não descritos na página).
- Se a separação por plano vai ser implementada (e como: flags, telas divididas, RLS) e o que fazer com o texto de `saas_planos.recursos`.
- WhatsApp automático: não mencionado nas páginas; franquia/custo indefinidos.
- Trabalho sem internet por plano e por módulo.
- Cobertura fiscal (NF-e/NFS-e) a descrever por plano.

## 5. Alterações (apresentação das páginas públicas)
- `src/routes/index.tsx`: nova seção "Módulos setoriais" (Pet shop, Clínica, Lava-rápido) com recursos existentes e a frase de inclusão na mensalidade; bloco "Contratação inicial" separado em implantação R$ 1.500 (demais segmentos) e treinamento e configuração inicial R$ 299 (taxa única; pet shop, clínica e lava-rápido; o pet shop entrou depois); texto do WhatsApp com a marca nova. Expansão (R$ 599/R$ 149, R$ 390/R$ 99), preços, limites, teste e contatos intactos.
- `src/routes/funcionalidades.tsx`: chip "Funciona sem internet" trocado por "Vende sem internet"; texto do WhatsApp com a marca nova.

## 6. Validação
- `npm run lint`, `npm test` (602 testes) e `npm run build` passam.
- Página inicial (seção de planos) em 320px, 390px e 1280px, claro e escuro: sem rolagem horizontal nem elemento fora da tela; implantação separada da mensalidade. Conferência visual em 320px e 1280px (claro).
- Contraste: textos novos usam os mesmos tokens já medidos (texto escuro sobre #e6f5ed, 15:1; texto de marca sobre fundo claro, 4,5:1 ou mais).
- Não validado: telas internas, cobrança e `/planos` (não alterados), e a validação de 390px foi só de transbordo (sem captura visual).
