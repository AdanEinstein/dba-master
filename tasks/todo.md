## Task 1: Setup Driver e Conexão (mysql-connection.ts)

**Description:** Instalar dependências e criar a base de conexão com pool.

**Acceptance criteria:**
- [x] Dependência `mysql2` adicionada ao `package.json` e instalada.
- [x] Classe `MysqlConnection` implementada com lazy pool e método `query<T>()`.
- [x] Pool respeita `cfg.poolMax` e `.close()` encerra o pool.

**Verification:**
- [x] Build succeeds: `npm run build`

**Dependencies:** None

**Files likely touched:**
- `package.json`
- `src/infrastructure/mysql/mysql-connection.ts`

**Estimated scope:** Small: 1-2 files

---

## Task 2: Queries e Provider Skeleton e Wiring

**Description:** Criar o esqueleto do provider, implementar as queries básicas (placeholder) e conectar no `ProviderManager`.

**Acceptance criteria:**
- [x] Classe `MysqlQueries` criada recebendo connection e filter schemas no construtor.
- [x] Classe `MysqlProvider` implementa `DatabaseProvider` marcando `engine = "mysql"`, `packages = false`, `scheduledJobs = false`.
- [x] Mapeamento básico `typeToTs` implementado.
- [x] `MysqlProvider` registrado no `ProviderManager`.

**Verification:**
- [x] Build succeeds: `npm run build`
- [x] Mensagem de erro atualizada em `ProviderManager` para referenciar o MySQL.

**Dependencies:** Task 1

**Files likely touched:**
- `src/infrastructure/mysql/mysql-queries.ts`
- `src/infrastructure/mysql/mysql-provider.ts`
- `src/infrastructure/provider-manager.ts`

**Estimated scope:** Medium: 3-5 files

---

## Task 3: Metadados de Tabelas e Colunas

**Description:** Implementar queries do dialeto para listar e descrever tabelas, bem como mapear esses resultados para os DTOs do domínio.

**Acceptance criteria:**
- [x] `MysqlQueries` possui SQLs usando `information_schema.tables` e `columns`.
- [x] `MysqlProvider` implementa `listTables` e `describeTable`.
- [x] Lógica de filtro de schema (ou database, no caso do MySQL) implementada no provider/queries.

**Verification:**
- [x] Build succeeds: `npm run build`
- [ ] Manual check: Conectar num MySQL local e rodar a tool MCP correspondente.

**Dependencies:** Task 2

**Files likely touched:**
- `src/infrastructure/mysql/mysql-queries.ts`
- `src/infrastructure/mysql/mysql-provider.ts`

**Estimated scope:** Small: 1-2 files

---

## Task 4: Metadados de Views

**Description:** Adicionar a listagem e descrição de views.

**Acceptance criteria:**
- [x] SQLs para `information_schema.views` criados.
- [x] `listViews` e `describeView` implementados transformando as linhas cruas.

**Verification:**
- [x] Build succeeds: `npm run build`

**Dependencies:** Task 2

**Files likely touched:**
- `src/infrastructure/mysql/mysql-queries.ts`
- `src/infrastructure/mysql/mysql-provider.ts`

**Estimated scope:** Small: 1-2 files

---

## Task 5: Relacionamentos (Foreign Keys) e DDL Times

**Description:** Implementar a lógica para encontrar FKs e inferir mapeamentos de integridade referencial.

**Acceptance criteria:**
- [x] Queries que consultam `key_column_usage` e `referential_constraints`.
- [x] Implementação de `getRelationships` no provider.
- [x] Opcionalmente, implementar `listDdlTimes` se for barato obter no MySQL (ex: via `update_time` em `information_schema.tables`).

**Verification:**
- [x] Build succeeds: `npm run build`
- [ ] Teste real executando request de relacionamentos de uma tabela MySQL.

**Dependencies:** Task 3

**Files likely touched:**
- `src/infrastructure/mysql/mysql-queries.ts`
- `src/infrastructure/mysql/mysql-provider.ts`

**Estimated scope:** Small: 1-2 files

---

## Task 6: Atualizar scripts de instalação (`setup/`)

**Description:** Incluir o novo engine MySQL/MariaDB nos utilitários de instalação (wizard) interativa.

**Acceptance criteria:**
- [x] Em `setup/index.ts`, a opção `mysql` está habilitada e pede as credenciais apropriadas (host/port/user/pass etc) para gerar a string de conexão.
- [x] O `banner.ts` menciona MySQL.

**Verification:**
- [x] Rodar o setup `npx tsx setup/index.ts` e ver se MySQL está nas opções.

**Dependencies:** Task 2

**Files likely touched:**
- `setup/index.ts`
- `setup/banner.ts`
- `setup/install-agents.ts`
- `setup/install-mcp.ts`

**Estimated scope:** Medium: 3-5 files

---

## Task 7: Atualizar README e demais docs

**Description:** Garantir que o README e qualquer documentação técnica indique o suporte a MySQL/MariaDB.

**Acceptance criteria:**
- [x] Atualizar a seção de "Bancos suportados" para incluir MySQL e seus recursos suportados.
- [x] Referências a string de conexão e outras documentações pertinentes.

**Verification:**
- [x] Revisão visual no Markdown preview.

**Dependencies:** Task 6

**Files likely touched:**
- `README.md`

**Estimated scope:** Small: 1-2 files
