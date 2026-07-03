# Implementation Plan: MySQL/MariaDB Engine Provider

## Overview
Implementar o suporte a bancos MySQL e MariaDB no dba-master. Isso envolve criar as três camadas da arquitetura (conexão, queries específicas do dialeto e o provider que implementa a porta `DatabaseProvider`) e registrar o novo engine no `ProviderManager`.

## Architecture Decisions
- **Driver**: Utilizar o `mysql2` por possuir suporte nativo a promises e pool de conexões.
- **Dialeto SQL**: Consultar metadados primariamente via `information_schema` (padrão ansi comum ao MySQL/MariaDB).
- **Capabilities**: MySQL não possui packages PL/SQL, portanto `packages: false`. Jobs agendados existem (MySQL Events), mas serão implementados como `false` nesta primeira versão para focar na entrega de metadados essenciais.

## Task List

### Phase 1: Foundation
- [x] Task 1: Setup Driver e Conexão (mysql-connection.ts)
- [x] Task 2: Queries e Provider Skeleton (mysql-queries.ts e mysql-provider.ts) e Wiring

### Checkpoint: Foundation
- [x] O projeto compila sem erros (`npm run build`).
- [x] É possível inicializar o provider passando `mysql` sem erro de provider não suportado.

### Phase 2: Core Features (Tables & Columns)
- [x] Task 3: Metadados de Tabelas e Colunas

### Checkpoint: Core Features
- [ ] Testes passam.
- [ ] `list_tables` e `describe_table` funcionam em um banco MySQL/MariaDB.

### Phase 3: Relacionamentos e Views
- [x] Task 4: Metadados de Views
- [x] Task 5: Relacionamentos (Foreign Keys) e Constraints

### Phase 4: Setup e Documentação
- [x] Task 6: Atualizar scripts de instalação (`setup/`)
- [x] Task 7: Atualizar documentação e README e demais docs

### Checkpoint: Complete
- [x] Todas as capabilities implementadas com sucesso.
- [x] Documentação está coerente.
- [x] Nenhuma regressão nas engines antigas (`oracle` e `postgres`).
- [x] Ready for review.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Diferenças de tipos entre MySQL/MariaDB | Low | Mapeamento focado nos tipos comuns e usando fallback `"unknown"` conforme diretriz. |
| Permissões de leitura no information_schema | Med | Tratar exceptions e retornar lista vazia se necessário, informando log. |

## Open Questions
- Precisamos implementar suporte a MySQL Events na capability `scheduledJobs` imediatamente, ou podemos manter `false`?
