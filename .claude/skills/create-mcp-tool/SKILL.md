---
name: create-mcp-tool
description: >-
  Adiciona uma nova tool MCP ao dba-master seguindo o padrão do projeto. Use
  sempre que o usuário quiser "criar uma tool", "expor uma nova capacidade via
  MCP", "adicionar um comando ao servidor MCP", "que o agente consiga fazer X no
  banco", ou pedir uma funcionalidade nova que os agentes de IA vão chamar (ex.:
  listar sinônimos, contar linhas, exportar CSV). Guia o boilerplate correto
  (zod inputSchema, envelope jsonResult/errorResult, registro no register.ts) e,
  quando a tool precisa de dado novo do banco, como estender a porta
  DatabaseProvider. Não use para adicionar suporte a um banco novo (isso é
  create-engine-provider).
---

# Adicionar uma tool MCP

Cada tool é um módulo em `src/mcp/tools/<nome>.tool.ts` que exporta uma função
`register(server, provider, cfg?)`. Todas seguem o mesmo formato — leia
`src/mcp/tools/list-tables.tool.ts` (a mais simples) como referência antes de
começar. Se a tool gera cache `.ts`, veja também `describe-table.tool.ts`.

Toda tool devolve **JSON estruturado** (não texto pra humano) porque o consumidor
é outro agente de IA. Os utilitários de `src/mcp/shared.ts` garantem esse contrato:
`jsonResult(data)` para sucesso, `errorResult(e)` para falha. Sempre embrulhe a
lógica em `try/catch` e devolva `errorResult(e)` no catch — assim o agente recebe
o erro como JSON em vez de derrubar a chamada.

## Decisão inicial: o dado já existe no provider?

- **Sim** (você só recombina algo que a porta `DatabaseProvider` já expõe): crie
  só o arquivo da tool. Não toque em `domain/` nem nos providers.
- **Não** (a tool precisa de um dado que nenhum método da porta devolve): você
  precisa estender a porta **antes**. Adicione o método em
  `src/domain/database-provider.ts` e implemente em **todos** os providers de
  `src/infrastructure/*/` (hoje só Oracle). O build quebra se faltar algum — use
  isso como checklist. DTOs novos vão em `src/domain/types.ts`.

## Passos

1. **Crie `src/mcp/tools/<nome>.tool.ts`.** Espelhe `list-tables.tool.ts`:

   ```ts
   import { z } from "zod";
   import type { McpServer } from "@modelcontextprotocol/server";
   import type { ProviderManager } from "../../infrastructure/provider-manager.js";
   import { jsonResult, errorResult, schemaArg, connectionArg } from "../shared.js";

   export function register(server: McpServer, provider: ProviderManager): void {
     server.registerTool(
       "nome_da_tool", // snake_case — é o nome que o agente chama
       {
         title: "Título curto",
         description: "O que faz e quando usar. É o que o agente lê pra decidir chamar.",
         inputSchema: z.object({ connectionName: connectionArg, schema: schemaArg }),
       },
       async ({ connectionName, schema }) => {
         const db = provider.getProvider(connectionName);
         try {
           return jsonResult({ /* ... */ });
         } catch (e) {
           return errorResult(e);
         }
       },
     );
   }
   ```

   - Reutilize os args de `shared.ts` (`connectionArg`, `schemaArg`, `patternArg`)
     em vez de redefinir. `connectionArg` é obrigatório em toda tool que fala com o
     banco — é como o usuário escolhe a conexão quando há mais de uma.
   - `.describe()` em cada arg: o agente usa essa descrição pra preencher o
     parâmetro. Vale o mesmo capricho da `description` da tool.

2. **Precisa de `cfg` (Config)?** Só se a tool mexe em cache/arquivo (como
   `describe-table` e `generate-interfaces`). Aí a assinatura vira
   `register(server, provider, cfg)` e você passa `cfg` no registro (passo 3).
   A maioria das tools não precisa.

3. **Registre em `src/mcp/register.ts`.** Adicione o `import * as <nome> from
   "./tools/<nome>.tool.js";` (extensão `.js` — é ESM) e a chamada
   `<nome>.register(server, provider)` dentro de `registerTools`. Passe `cfg`
   como terceiro argumento **só** se a tool o recebe. Sem esse registro a tool
   existe mas nunca é exposta.

4. **Documente em `docs/tools.md`.** Adicione uma linha na tabela: nome, o que
   faz, parâmetros. É a fonte que descreve a superfície MCP.

## Verificação

```bash
npm run build && npm test
```

O build valida os tipos (inclusive se você esqueceu de implementar o novo método
da porta em algum provider). Depois, suba o server e chame a tool de verdade
contra uma conexão real — uma tool que compila mas monta o JSON errado só aparece
rodando. Se a tool tem lógica não-trivial (parsing, agregação), considere um
`*.test.ts` ao lado, no padrão dos testes existentes em `src/`.
