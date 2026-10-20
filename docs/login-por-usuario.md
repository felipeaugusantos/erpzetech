# Login por usuário

O acesso passa a ser pelo **usuário** da pessoa dentro da empresa, e não mais pelo e-mail. Vários usuários podem ter o mesmo e-mail de contato.

## Regras

- **Escopo:** o usuário vale dentro da empresa. O mesmo usuário (ex.: `bruna`) pode existir em empresas diferentes. Formato: de 3 a 30 caracteres, letras minúsculas sem acento, números, ponto, hífen ou sublinhado. Único por empresa (índice `profiles_tenant_usuario_uk`).
- **E-mail:** vira só contato (`profiles.email`), opcional e repetível. O provedor de autenticação exige um e-mail único por conta, então quem é criado por usuário recebe um endereço interno (`<usuario>.<empresa>@usuarios.erpzetech.invalid`, domínio reservado, que nunca recebe mensagem e não aparece na tela).
- **Quem já existia** continua entrando pelo e-mail e ganhou um usuário sugerido (a parte do e-mail antes do @, com número no fim se já houver igual na empresa). O administrador pode trocar em Usuários e perfis. O campo de login aceita usuário ou e-mail.
- **Como entra:** pela página da empresa (o link dela) basta o usuário e a senha. Pela página geral (`/auth`), quem digita usuário informa também o link da empresa. A conferência da senha é feita no servidor (`entrarPorUsuario`): o navegador só recebe a sessão, nunca o endereço interno, e o erro é sempre "Usuário ou senha incorretos" (não revela quem existe na empresa).
- **Quem troca o usuário:** só o administrador da empresa (ou a equipe Ze Tech). A pessoa não troca o próprio usuário pelo perfil (trava no banco).
- **Esqueceu a senha:** o administrador define uma nova em Usuários e perfis. Não há recuperação por e-mail: o sistema não tem serviço de envio de e-mail e o e-mail de contato pode ser repetido.
- Também seguem esse login: criação de usuário em Usuários e perfis, login do motorista (Motoristas) e troca de operador no caixa (usuário ou e-mail, na empresa de quem já está logado).
- Fora desta mudança: a conta de equipe Ze Tech (`/ze-tech-login`) e o acesso com Google continuam por e-mail.
