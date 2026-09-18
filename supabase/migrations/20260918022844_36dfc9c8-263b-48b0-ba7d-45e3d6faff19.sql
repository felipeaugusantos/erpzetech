
-- ========= ENUMS =========
create type public.app_role as enum ('administrador','gestor','vendedor','caixa','estoquista','comprador','financeiro','logistica','motorista');
create type public.pessoa_tipo as enum ('PF','PJ');
create type public.obra_situacao as enum ('planejamento','em_andamento','pausada','concluida','cancelada');
create type public.mov_tipo as enum ('entrada','saida','ajuste','inventario','transferencia_saida','transferencia_entrada','reserva','liberacao_reserva');

-- ========= CORE =========
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  slug text unique,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  razao_social text not null,
  nome_fantasia text,
  cnpj text,
  inscricao_estadual text,
  telefone text,
  email text,
  cep text, endereco text, numero text, complemento text, bairro text, cidade text, estado text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.filiais (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  codigo text,
  telefone text,
  cep text, endereco text, numero text, bairro text, cidade text, estado text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key,
  tenant_id uuid references public.tenants(id) on delete set null,
  empresa_id uuid references public.empresas(id) on delete set null,
  filial_id uuid references public.filiais(id) on delete set null,
  nome text not null default '',
  email text,
  telefone text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  tenant_id uuid references public.tenants(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create table public.role_permissoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role public.app_role not null,
  modulo text not null,
  pode_ver boolean not null default true,
  pode_criar boolean not null default false,
  pode_editar boolean not null default false,
  pode_excluir boolean not null default false,
  unique (tenant_id, role, modulo)
);

-- ========= HELPERS =========
create or replace function public.current_tenant_id()
returns uuid language sql stable security definer set search_path = public as $$
  select tenant_id from public.profiles where id = auth.uid()
$$;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

-- new users join the demo tenant as administrators (single-company MVP onboarding)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare t_id uuid; e_id uuid; f_id uuid;
begin
  select id into t_id from public.tenants order by created_at limit 1;
  select id into e_id from public.empresas where tenant_id = t_id order by created_at limit 1;
  select id into f_id from public.filiais where tenant_id = t_id order by created_at limit 1;

  insert into public.profiles (id, tenant_id, empresa_id, filial_id, nome, email)
  values (new.id, t_id, e_id, f_id, coalesce(new.raw_user_meta_data->>'nome', new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), new.email);

  insert into public.user_roles (user_id, tenant_id, role) values (new.id, t_id, 'administrador')
  on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ========= COMERCIAL / CADASTROS =========
create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  empresa_id uuid references public.empresas(id) on delete set null,
  filial_id uuid references public.filiais(id) on delete set null,
  tipo public.pessoa_tipo not null default 'PF',
  nome text not null,
  nome_fantasia text,
  cpf text, cnpj text, inscricao_estadual text,
  telefone text, whatsapp text, email text,
  cep text, endereco text, numero text, complemento text, bairro text, cidade text, estado text,
  limite_credito numeric(14,2) not null default 0,
  saldo_utilizado numeric(14,2) not null default 0,
  prazo_padrao_dias integer not null default 0,
  desconto_maximo numeric(5,2) not null default 0,
  observacoes text,
  ativo boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.obras (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  nome text not null,
  cep text, endereco text, numero text, bairro text, cidade text, estado text,
  responsavel text, telefone text, observacoes text,
  data_inicio date, previsao_termino date,
  situacao public.obra_situacao not null default 'planejamento',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  razao_social text not null,
  nome_fantasia text,
  cnpj text, contato text, telefone text, whatsapp text, email text,
  cep text, endereco text, numero text, bairro text, cidade text, estado text,
  prazo_entrega_dias integer default 0,
  condicao_pagamento text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categorias (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nome text not null,
  parent_id uuid references public.categorias(id) on delete set null,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.produtos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  codigo_interno text not null,
  codigo_barras text,
  descricao text not null,
  descricao_resumida text,
  categoria_id uuid references public.categorias(id) on delete set null,
  marca text, fabricante text,
  fornecedor_id uuid references public.fornecedores(id) on delete set null,
  ncm text,
  unidade text not null default 'UN',
  unidade_compra text,
  unidade_venda text,
  fator_conversao numeric(14,4) not null default 1,
  custo numeric(14,4) not null default 0,
  preco_venda numeric(14,4) not null default 0,
  estoque_minimo numeric(14,3) not null default 0,
  estoque_maximo numeric(14,3) not null default 0,
  localizacao text,
  peso numeric(12,3), altura numeric(12,3), largura numeric(12,3), comprimento numeric(12,3),
  imagem_url text,
  ativo boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, codigo_interno)
);

create table public.produto_conversoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete cascade,
  unidade text not null,
  fator numeric(14,4) not null default 1,
  descricao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

-- ========= ESTOQUE =========
create table public.depositos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  filial_id uuid references public.filiais(id) on delete set null,
  nome text not null,
  tipo text default 'proprio',
  endereco text,
  permite_negativo boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.estoques (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete cascade,
  deposito_id uuid not null references public.depositos(id) on delete cascade,
  quantidade numeric(14,3) not null default 0,
  reservado numeric(14,3) not null default 0,
  localizacao text,
  updated_at timestamptz not null default now(),
  unique (produto_id, deposito_id)
);

create table public.estoque_movimentacoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete restrict,
  deposito_id uuid not null references public.depositos(id) on delete restrict,
  deposito_destino_id uuid references public.depositos(id) on delete restrict,
  tipo public.mov_tipo not null,
  quantidade numeric(14,3) not null,
  saldo_anterior numeric(14,3),
  saldo_posterior numeric(14,3),
  unidade text,
  documento text,
  motivo text,
  usuario_id uuid,
  created_at timestamptz not null default now()
);

create table public.auditoria (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  usuario_id uuid,
  entidade text not null,
  entidade_id uuid,
  operacao text not null,
  valor_anterior jsonb,
  valor_novo jsonb,
  created_at timestamptz not null default now()
);

-- ========= INDEXES =========
create index on public.clientes (tenant_id);
create index on public.obras (tenant_id, cliente_id);
create index on public.produtos (tenant_id, categoria_id);
create index on public.estoques (tenant_id, deposito_id);
create index on public.estoque_movimentacoes (tenant_id, produto_id, created_at desc);

-- ========= UPDATED_AT TRIGGERS =========
do $$ declare t text;
begin
  foreach t in array array['empresas','filiais','profiles','clientes','obras','fornecedores','produtos','estoques']
  loop
    execute format('create trigger trg_%1$s_touch before update on public.%1$s for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- movimentações são imutáveis
create or replace function public.block_write()
returns trigger language plpgsql set search_path = public as $$
begin raise exception 'Movimentações de estoque não podem ser alteradas ou excluídas'; end $$;
create trigger trg_mov_immutable before update or delete on public.estoque_movimentacoes
for each row execute function public.block_write();

-- ========= GRANTS + RLS =========
do $$
declare t text;
begin
  foreach t in array array['tenants','empresas','filiais','profiles','user_roles','role_permissoes','clientes','obras','fornecedores','categorias','produtos','produto_conversoes','depositos','estoques','estoque_movimentacoes','auditoria']
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- tenant-scoped tables
do $$
declare t text;
begin
  foreach t in array array['empresas','filiais','role_permissoes','clientes','obras','fornecedores','categorias','produtos','produto_conversoes','depositos','estoques']
  loop
    execute format($f$create policy "tenant_read_%1$s" on public.%1$I for select to authenticated using (tenant_id = public.current_tenant_id())$f$, t);
    execute format($f$create policy "tenant_insert_%1$s" on public.%1$I for insert to authenticated with check (tenant_id = public.current_tenant_id())$f$, t);
    execute format($f$create policy "tenant_update_%1$s" on public.%1$I for update to authenticated using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id())$f$, t);
  end loop;
end $$;

-- deletes only for admins/managers on cadastros
do $$
declare t text;
begin
  foreach t in array array['clientes','obras','fornecedores','categorias','produtos','produto_conversoes','depositos']
  loop
    execute format($f$create policy "tenant_delete_%1$s" on public.%1$I for delete to authenticated using (tenant_id = public.current_tenant_id() and (public.has_role(auth.uid(),'administrador') or public.has_role(auth.uid(),'gestor')))$f$, t);
  end loop;
end $$;

create policy "tenants_read" on public.tenants for select to authenticated using (id = public.current_tenant_id());

create policy "profiles_read_same_tenant" on public.profiles for select to authenticated using (tenant_id = public.current_tenant_id() or id = auth.uid());
create policy "profiles_update_self" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles_update_admin" on public.profiles for update to authenticated using (tenant_id = public.current_tenant_id() and public.has_role(auth.uid(),'administrador')) with check (tenant_id = public.current_tenant_id());

create policy "roles_read" on public.user_roles for select to authenticated using (tenant_id = public.current_tenant_id() or user_id = auth.uid());
create policy "roles_admin_insert" on public.user_roles for insert to authenticated with check (tenant_id = public.current_tenant_id() and public.has_role(auth.uid(),'administrador'));
create policy "roles_admin_update" on public.user_roles for update to authenticated using (tenant_id = public.current_tenant_id() and public.has_role(auth.uid(),'administrador')) with check (tenant_id = public.current_tenant_id());
create policy "roles_admin_delete" on public.user_roles for delete to authenticated using (tenant_id = public.current_tenant_id() and public.has_role(auth.uid(),'administrador'));

create policy "mov_read" on public.estoque_movimentacoes for select to authenticated using (tenant_id = public.current_tenant_id());
create policy "mov_insert" on public.estoque_movimentacoes for insert to authenticated with check (tenant_id = public.current_tenant_id());

create policy "audit_read" on public.auditoria for select to authenticated using (tenant_id = public.current_tenant_id());
create policy "audit_insert" on public.auditoria for insert to authenticated with check (tenant_id = public.current_tenant_id());

-- ========= DEMO DATA =========
insert into public.tenants (id, nome, slug) values ('11111111-1111-1111-1111-111111111111','Constrular','constrular');

insert into public.empresas (id, tenant_id, razao_social, nome_fantasia, cnpj, telefone, email, cidade, estado, endereco, numero, bairro, cep)
values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Constrular Materiais para Construcao LTDA','Constrular','12.345.678/0001-90','(11) 3555-1200','contato@constrular.com.br','São Paulo','SP','Av. das Nações','1500','Centro','01010-000');

insert into public.filiais (id, tenant_id, empresa_id, nome, codigo, telefone, cidade, estado, endereco, numero, bairro, cep)
values ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Loja Centro','001','(11) 3555-1201','São Paulo','SP','Av. das Nações','1500','Centro','01010-000');

insert into public.depositos (id, tenant_id, filial_id, nome, tipo) values
('44444444-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','Depósito Principal','proprio'),
('44444444-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','Depósito Loja','loja'),
('44444444-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','Depósito Externo','externo');

insert into public.categorias (tenant_id, nome)
select '11111111-1111-1111-1111-111111111111', x from unnest(array['Cimento','Areia','Pedra','Tijolos','Blocos','Pisos','Revestimentos','Argamassa','Tintas','Hidráulica','Elétrica','Ferramentas','Ferragens','Madeira','Telhas','Portas','Janelas','Louças','Metais','Iluminação']) as x;

insert into public.fornecedores (tenant_id, razao_social, nome_fantasia, cnpj, contato, telefone, email, cidade, estado, prazo_entrega_dias, condicao_pagamento) values
('11111111-1111-1111-1111-111111111111','Cimentos Votoran S.A.','Votoran','11.111.111/0001-11','Marcos Lima','(11) 4002-8922','vendas@votoran.com.br','Sorocaba','SP',5,'28 dias'),
('11111111-1111-1111-1111-111111111111','Ceramica Portobello LTDA','Portobello','22.222.222/0001-22','Ana Souza','(48) 3279-1000','comercial@portobello.com.br','Tijucas','SC',10,'30/60 dias'),
('11111111-1111-1111-1111-111111111111','Tigre Tubos e Conexoes','Tigre','33.333.333/0001-33','Rafael Dias','(47) 3341-5000','pedidos@tigre.com.br','Joinville','SC',7,'À vista'),
('11111111-1111-1111-1111-111111111111','Suvinil Tintas','Suvinil','44.444.444/0001-44','Carla Nunes','(11) 4589-0000','sac@suvinil.com.br','Guarulhos','SP',6,'28/56 dias'),
('11111111-1111-1111-1111-111111111111','Distribuidora Sao Jorge de Agregados','Agregados SJ','55.555.555/0001-55','José Pereira','(11) 4777-3300','vendas@agregadossj.com.br','Mairiporã','SP',2,'À vista');

insert into public.clientes (tenant_id, empresa_id, filial_id, tipo, nome, nome_fantasia, cpf, cnpj, telefone, whatsapp, email, cidade, estado, endereco, numero, bairro, cep, limite_credito, saldo_utilizado, prazo_padrao_dias, desconto_maximo) values
('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','PF','João Batista Ferreira',null,'123.456.789-00',null,'(11) 98877-1122','(11) 98877-1122','joao.ferreira@email.com','São Paulo','SP','Rua das Acácias','230','Vila Mariana','04101-000',10000,7000,30,5),
('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','PJ','Construtora Alfa Engenharia LTDA','Alfa Engenharia',null,'66.666.666/0001-66','(11) 3322-4400','(11) 99123-4455','compras@alfaeng.com.br','São Paulo','SP','Av. Paulista','900','Bela Vista','01310-100',80000,23500,45,12),
('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','PF','Maria Aparecida Gomes',null,'987.654.321-00',null,'(11) 97654-3210','(11) 97654-3210','maria.gomes@email.com','Guarulhos','SP','Rua Bahia','58','Jardim Bela Vista','07020-000',5000,0,0,3),
('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','PJ','Reforma Rapida Servicos LTDA','Reforma Rápida',null,'77.777.777/0001-77','(11) 3011-7788','(11) 98111-2233','financeiro@reformarapida.com.br','São Bernardo do Campo','SP','Rua Marechal Deodoro','410','Centro','09710-000',25000,24000,30,8),
('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','PF','Carlos Eduardo Ramos',null,'321.654.987-00',null,'(11) 96543-2100','(11) 96543-2100','carlos.ramos@email.com','Osasco','SP','Rua Antônio Agu','1200','Centro','06013-000',7500,1200,15,5);

insert into public.obras (tenant_id, cliente_id, nome, endereco, numero, bairro, cidade, estado, responsavel, telefone, situacao, data_inicio, previsao_termino)
select '11111111-1111-1111-1111-111111111111', c.id, o.nome, o.endereco, o.numero, o.bairro, 'São Paulo','SP', o.resp, o.tel, o.sit::public.obra_situacao, o.ini::date, o.fim::date
from (values
 ('João Batista Ferreira','Residência Vila Mariana','Rua das Acácias','230','Vila Mariana','João Ferreira','(11) 98877-1122','em_andamento','2026-06-01','2026-12-20'),
 ('Construtora Alfa Engenharia LTDA','Edifício Alfa Tower','Rua Vergueiro','2100','Paraíso','Eng. Paulo Reis','(11) 3322-4401','em_andamento','2026-03-10','2027-05-30'),
 ('Construtora Alfa Engenharia LTDA','Galpão Industrial Zona Leste','Av. Aricanduva','5500','Aricanduva','Eng. Paulo Reis','(11) 3322-4402','planejamento','2026-10-01','2027-08-30'),
 ('Reforma Rapida Servicos LTDA','Reforma Loja Centro','Rua Direita','120','Centro','Ana Lopes','(11) 98111-2233','pausada','2026-05-15','2026-11-15'),
 ('Maria Aparecida Gomes','Ampliação Casa Guarulhos','Rua Bahia','58','Jardim Bela Vista','Maria Gomes','(11) 97654-3210','concluida','2026-01-20','2026-07-10')
) as o(cliente,nome,endereco,numero,bairro,resp,tel,sit,ini,fim)
join public.clientes c on c.nome = o.cliente and c.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into public.produtos (tenant_id, codigo_interno, codigo_barras, descricao, descricao_resumida, categoria_id, marca, fabricante, ncm, unidade, unidade_compra, unidade_venda, fator_conversao, custo, preco_venda, estoque_minimo, estoque_maximo, localizacao, peso)
select '11111111-1111-1111-1111-111111111111', p.cod, p.barras, p.desc_, p.resumo, cat.id, p.marca, p.marca, p.ncm, p.un, p.un_compra, p.un_venda, p.fator, p.custo, p.preco, p.emin, p.emax, p.loc, p.peso
from (values
 ('CIM001','7891000000011','Cimento CP-II 32 Saco 50 kg','Cimento CP-II 50kg','Cimento','Votoran','2523.29.10','SC','PALETE','SC',50,26.50,36.90,100,600,'A-01',50),
 ('CIM002','7891000000028','Cimento CP-V ARI Saco 50 kg','Cimento CP-V 50kg','Cimento','Votoran','2523.29.10','SC','PALETE','SC',50,31.00,42.90,60,400,'A-02',50),
 ('ARE001','7891000000035','Areia Média Lavada','Areia média m³','Areia','Agregados SJ','2505.10.00','M3','CAMINHAO','M3',6,75.00,120.00,10,120,'PATIO-1',1500),
 ('ARE002','7891000000042','Areia Fina','Areia fina m³','Areia','Agregados SJ','2505.10.00','M3','CAMINHAO','M3',6,72.00,115.00,10,120,'PATIO-2',1500),
 ('PED001','7891000000059','Pedra Brita 1','Brita 1 m³','Pedra','Agregados SJ','2517.10.00','M3','CAMINHAO','M3',6,88.00,135.00,10,100,'PATIO-3',1600),
 ('PED002','7891000000066','Pedrisco','Pedrisco m³','Pedra','Agregados SJ','2517.10.00','M3','CAMINHAO','M3',6,84.00,128.00,8,80,'PATIO-4',1600),
 ('TIJ001','7891000000073','Tijolo Cerâmico 6 Furos 9x14x19','Tijolo 6 furos','Tijolos','Cerâmica Paulista','6904.10.00','UN','PALETE','UN',300,0.95,1.60,2000,20000,'B-01',2.4),
 ('BLO001','7891000000080','Bloco de Concreto Estrutural 14x19x39','Bloco estrutural','Blocos','Blocopar','6810.11.00','UN','PALETE','UN',120,4.20,6.90,800,8000,'B-02',11),
 ('ARG001','7891000000097','Argamassa Colante AC2 20 kg','Argamassa AC2','Argamassa','Quartzolit','3824.50.00','SC','PALETE','SC',60,18.40,26.50,80,600,'C-01',20),
 ('ARG002','7891000000103','Argamassa Colante AC3 20 kg','Argamassa AC3','Argamassa','Quartzolit','3824.50.00','SC','PALETE','SC',60,24.90,34.90,60,400,'C-02',20),
 ('POR001','7891000000110','Porcelanato Acetinado 60x60 cm','Porcelanato 60x60','Pisos','Portobello','6907.21.00','M2','CAIXA','M2',2.5,52.00,79.90,40,400,'D-01',22),
 ('PIS001','7891000000127','Piso Cerâmico 45x45 cm','Piso cerâmico 45x45','Pisos','Eliane','6907.21.00','M2','CAIXA','M2',2.0,26.00,39.90,60,600,'D-02',18),
 ('REV001','7891000000134','Revestimento Cerâmico 33x60 cm','Revestimento 33x60','Revestimentos','Eliane','6907.22.00','M2','CAIXA','M2',1.98,31.00,47.90,40,300,'D-03',16),
 ('TIN001','7891000000141','Tinta Acrílica Premium Branca 18 L','Tinta acrílica 18L','Tintas','Suvinil','3209.10.10','LT','CAIXA','LT',4,215.00,299.90,15,90,'E-01',24),
 ('TIN002','7891000000158','Tinta Látex Econômica 18 L','Tinta látex 18L','Tintas','Suvinil','3209.10.10','LT','CAIXA','LT',4,118.00,169.90,15,80,'E-02',24),
 ('ELE001','7891000000165','Cabo Flexível 2,5 mm² 750V','Cabo flex 2,5mm','Elétrica','Sil','8544.49.00','M','ROLO','M',100,2.35,3.90,300,3000,'F-01',0.03),
 ('ELE002','7891000000172','Cabo Flexível 4 mm² 750V','Cabo flex 4mm','Elétrica','Sil','8544.49.00','M','ROLO','M',100,3.60,5.90,200,2000,'F-02',0.05),
 ('ELE003','7891000000189','Cabo Flexível 6 mm² 750V','Cabo flex 6mm','Elétrica','Sil','8544.49.00','M','ROLO','M',100,5.40,8.50,150,1500,'F-03',0.07),
 ('ELE004','7891000000196','Disjuntor Monopolar 25A','Disjuntor 25A','Elétrica','Steck','8536.20.00','UN','CAIXA','UN',12,14.50,24.90,30,300,'F-04',0.15),
 ('HID001','7891000000202','Tubo PVC Esgoto 100 mm - 6 m','Tubo PVC 100mm','Hidráulica','Tigre','3917.23.00','BR','FARDO','BR',10,68.00,98.00,30,200,'G-01',5.5),
 ('HID002','7891000000219','Tubo PVC Esgoto 50 mm - 6 m','Tubo PVC 50mm','Hidráulica','Tigre','3917.23.00','BR','FARDO','BR',20,32.00,49.90,40,300,'G-02',2.8),
 ('HID003','7891000000226','Joelho PVC 90° 100 mm','Joelho PVC 100mm','Hidráulica','Tigre','3917.40.00','UN','CAIXA','UN',24,9.80,16.90,60,600,'G-03',0.3),
 ('HID004','7891000000233','Registro de Gaveta 3/4"','Registro gaveta 3/4','Metais','Docol','8481.80.93','UN','CAIXA','UN',10,42.00,69.90,20,200,'G-04',0.6),
 ('MET001','7891000000240','Torneira de Mesa Cromada Bica Móvel','Torneira mesa cromada','Metais','Docol','8481.80.11','UN','CAIXA','UN',6,128.00,199.90,10,80,'H-01',1.1),
 ('MET002','7891000000257','Chuveiro Elétrico 220V 5500W','Chuveiro elétrico','Metais','Lorenzetti','8516.10.00','UN','CAIXA','UN',6,89.00,139.90,15,120,'H-02',1.4),
 ('TEL001','7891000000264','Telha Fibrocimento 2,44 x 1,10 m','Telha fibrocimento','Telhas','Brasilit','6811.82.00','UN','PALETE','UN',40,68.00,99.90,50,400,'I-01',18),
 ('TEL002','7891000000271','Telha Cerâmica Portuguesa','Telha portuguesa','Telhas','Cerâmica Paulista','6905.10.00','UN','PALETE','UN',288,2.30,3.90,1000,10000,'I-02',2.5),
 ('POR002','7891000000288','Porta de Madeira Semi-Oca 80 cm','Porta madeira 80cm','Portas','Sincol','4418.20.00','UN','UN','UN',1,168.00,249.90,10,60,'J-01',22),
 ('JAN001','7891000000295','Janela de Alumínio 100x120 cm','Janela alumínio','Janelas','Sasazaki','7610.10.00','UN','UN','UN',1,395.00,569.90,5,40,'J-02',18),
 ('FER001','7891000000301','Trena Profissional 5 m','Trena 5m','Ferramentas','Tramontina','9017.80.10','UN','CAIXA','UN',12,19.90,34.90,20,150,'K-01',0.25),
 ('FER002','7891000000318','Barra de Aço CA-50 10 mm - 12 m','Aço CA-50 10mm','Ferragens','Gerdau','7214.20.00','UN','FARDO','UN',20,52.00,78.90,50,500,'K-02',7.4),
 ('LOU001','7891000000325','Vaso Sanitário com Caixa Acoplada','Vaso sanitário','Louças','Deca','6910.10.00','UN','UN','UN',1,398.00,599.90,8,50,'L-01',30),
 ('ILU001','7891000000332','Lâmpada LED Bulbo 12W','Lâmpada LED 12W','Iluminação','Philips','8539.50.00','UN','CAIXA','UN',25,7.90,14.90,100,800,'L-02',0.08)
) as p(cod,barras,desc_,resumo,categoria,marca,ncm,un,un_compra,un_venda,fator,custo,preco,emin,emax,loc,peso)
join public.categorias cat on cat.nome = p.categoria and cat.tenant_id = '11111111-1111-1111-1111-111111111111';

update public.produtos p set fornecedor_id = f.id
from public.fornecedores f
where p.tenant_id = '11111111-1111-1111-1111-111111111111' and f.tenant_id = p.tenant_id
  and ((p.marca = 'Votoran' and f.nome_fantasia = 'Votoran')
    or (p.marca in ('Portobello','Eliane') and f.nome_fantasia = 'Portobello')
    or (p.marca = 'Tigre' and f.nome_fantasia = 'Tigre')
    or (p.marca = 'Suvinil' and f.nome_fantasia = 'Suvinil')
    or (p.marca = 'Agregados SJ' and f.nome_fantasia = 'Agregados SJ'));

-- conversões de unidade (compra -> estoque)
insert into public.produto_conversoes (tenant_id, produto_id, unidade, fator, descricao)
select p.tenant_id, p.id, p.unidade_compra, p.fator_conversao,
       format('1 %s = %s %s', p.unidade_compra, trim(to_char(p.fator_conversao,'FM999999990.0999')), p.unidade)
from public.produtos p
where p.tenant_id = '11111111-1111-1111-1111-111111111111' and p.fator_conversao > 1;

-- estoque inicial no Depósito Principal e Loja
insert into public.estoques (tenant_id, produto_id, deposito_id, quantidade, reservado, localizacao)
select p.tenant_id, p.id, '44444444-0000-0000-0000-000000000001',
       round((p.estoque_minimo * (0.6 + ((abs(hashtext(p.codigo_interno)) % 220) / 100.0)))::numeric, 2),
       round((p.estoque_minimo * ((abs(hashtext(p.codigo_interno)) % 18) / 100.0))::numeric, 2),
       p.localizacao
from public.produtos p where p.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into public.estoques (tenant_id, produto_id, deposito_id, quantidade, reservado, localizacao)
select p.tenant_id, p.id, '44444444-0000-0000-0000-000000000002',
       round((p.estoque_minimo * ((abs(hashtext(p.descricao)) % 40) / 100.0))::numeric, 2), 0, 'LOJA'
from public.produtos p where p.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into public.estoque_movimentacoes (tenant_id, produto_id, deposito_id, tipo, quantidade, saldo_anterior, saldo_posterior, unidade, documento, motivo)
select e.tenant_id, e.produto_id, e.deposito_id, 'entrada', e.quantidade, 0, e.quantidade, p.unidade, 'INV-INICIAL', 'Carga inicial de estoque'
from public.estoques e join public.produtos p on p.id = e.produto_id
where e.tenant_id = '11111111-1111-1111-1111-111111111111' and e.quantidade > 0;

-- permissões iniciais por perfil
insert into public.role_permissoes (tenant_id, role, modulo, pode_ver, pode_criar, pode_editar, pode_excluir)
select '11111111-1111-1111-1111-111111111111', r.role::public.app_role, m.modulo,
  true,
  r.role in ('administrador','gestor') or (r.role='vendedor' and m.modulo in ('clientes','obras')) or (r.role='estoquista' and m.modulo in ('estoque','movimentacoes')) or (r.role='comprador' and m.modulo in ('produtos','estoque')),
  r.role in ('administrador','gestor') or (r.role='vendedor' and m.modulo in ('clientes','obras')) or (r.role='estoquista' and m.modulo in ('estoque','movimentacoes')),
  r.role = 'administrador'
from (values ('administrador'),('gestor'),('vendedor'),('caixa'),('estoquista'),('comprador'),('financeiro'),('logistica'),('motorista')) as r(role)
cross join (values ('dashboard'),('clientes'),('obras'),('produtos'),('categorias'),('estoque'),('movimentacoes'),('depositos'),('usuarios'),('configuracoes')) as m(modulo);
