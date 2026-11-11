# Contrato: clínica com ou sem pet shop

| Contrato                     | Como fica                                                                           | O que a equipe grava em `empresa_modulos_liberados` |
| ---------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Só pet shop**              | Área Pet shop completa, sem a Clínica                                               | `petshop` (ou ramo/CNAE de pet shop)                |
| **Pet shop + Clínica**       | As duas áreas completas                                                             | `clinica` (a clínica já libera o pet shop)          |
| **Só clínica, sem pet shop** | Clínica completa e, na área Pet shop, **só o que a clínica usa** (sem banho e tosa) | `clinica` **e** `sem_petshop`                       |

**Padrão:** sem o marcador `sem_petshop`, ninguém muda. Toda empresa de clínica existente continua com a área Pet shop inteira.

## Aplicar e desfazer (a equipe, com acesso de serviço ao banco)

A tabela só aceita escrita do serviço. Troque `EMPRESA_ID` pelo id da empresa (tabela `empresas`):

```sql
-- aplicar o contrato "só clínica, sem pet shop"
insert into public.empresa_modulos_liberados (empresa_id, modulo)
values ('EMPRESA_ID', 'sem_petshop')
on conflict do nothing;

-- desfazer (volta a clínica + pet shop)
delete from public.empresa_modulos_liberados
where empresa_id = 'EMPRESA_ID' and modulo = 'sem_petshop';
```

O efeito aparece no próximo carregamento do app da empresa.

## O que o marcador faz

- O pet shop deixa de ser liberado pela clínica, pelo ramo ou pelo CNAE. Só vale se `petshop` for liberado de forma explícita.
- **Continuam abertos**, porque a clínica depende deles: Pets e tutores, Contatos, **Serviços e preços** (consulta, vacina e exame), **Profissionais** (cadastro do veterinário com CRMV), **Agenda** e **Campos personalizados**.
- **Ficam bloqueados** (mostram o aviso de módulo bloqueado): Ordens de serviço, Pacotes e Comissões, que são de banho e tosa.
- No menu do **veterinário** e do profissional (que tem uma única área), essa área se chama **Clínica** na clínica sem pet shop e **Pet shop** nas demais (`rotuloAreaProfissional`). Só muda o nome do grupo, não as telas.
- O menu e a página de cada tela usam a mesma lista (`ITENS_PET_DA_CLINICA`); um teste confere que as duas concordam.
- O marcador não faz a empresa deixar de ser "só clínica".

## Limite conhecido

O pet shop é controlado **na tela** (menu e aviso nas páginas), como já era. O banco não tem uma trava própria para ele. Quem quiser bloquear também no banco precisa de um PR à parte.

## Tela da equipe

**Painel EZRA → Contrato da clínica** (`/ze-tech-contratos`): lista as empresas com clínica e mostra o contrato de cada uma. O botão **Marcar só clínica** grava o marcador e **Voltar a incluir o pet shop** o remove, sempre com confirmação.

- Só operadores da equipe Ze Tech veem a tela e usam as funções (conferência no servidor por `eh_saas_operador`).
- A gravação usa o serviço, porque a tabela de liberações não aceita escrita do app.
- Recusa empresa sem clínica e empresa com pet shop liberado de forma explícita (retire essa liberação antes).
- Se a migração 0081 ainda não foi aplicada, a gravação avisa para aplicá-la.
- Marcar o contrato muda o menu do cliente no próximo carregamento: combine com o cliente antes.
