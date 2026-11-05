# Contrato: clínica com ou sem pet shop

| Contrato                     | Como fica                                                              | O que a equipe grava em `empresa_modulos_liberados` |
| ---------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| **Só pet shop**              | Área Pet shop completa, sem a Clínica                                  | `petshop` (ou ramo/CNAE de pet shop)                |
| **Pet shop + Clínica**       | As duas áreas completas                                                | `clinica` (a clínica já libera o pet shop)          |
| **Só clínica, sem pet shop** | Clínica completa e, na área Pet shop, **só Pets e tutores e Contatos** | `clinica` **e** `sem_petshop`                       |

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
- As telas de serviços do pet shop (Agenda, Ordens de serviço, Serviços e preços, Profissionais, Campos personalizados, Pacotes e Comissões) mostram o aviso de módulo bloqueado.
- **Pets e tutores** e **Contatos** continuam abertos, porque a clínica usa o cadastro.
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
