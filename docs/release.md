# Release e uso sem o repositório

O dba-master é publicado no **npm** a cada tag. Quem não tem o repositório usa via `npx`,
sem clonar nem buildar.

## Usar sem o repositório (usuário final)

No config do cliente MCP, aponte para o pacote npm. As credenciais vão no bloco `env`
(o pacote instalado via `npx` **não tem `.env` ao lado** — a config vem do ambiente):

```jsonc
{
  "command": "npx",
  "args": ["-y", "dba-master"],
  "env": {
    "ORACLE_USER": "usuario",
    "ORACLE_PASSWORD": "senha",
    "ORACLE_CONNECT_STRING": "host:1521/service_name",
    "SCHEMA_FILTER": "",
    "READ_ONLY": "true"
  }
}
```

No Claude Code:

```bash
claude mcp add dba-master \
  -e ORACLE_USER=usuario -e ORACLE_PASSWORD=senha \
  -e ORACLE_CONNECT_STRING=host:1521/service_name \
  -- npx -y dba-master
```

Ou instale global e chame o binário direto:

```bash
npm i -g dba-master
# config MCP: { "command": "dba-master", "env": { ... } }
```

Modo **thin** (default) não exige Oracle Instant Client. Variáveis completas em
[instalacao.md](instalacao.md).

### Instalar o comando `dba-investigate` (sem o repo)

O server acima expõe as *tools*. Para instalar também o comando/skill `dba-investigate`
(workflow que orienta o agente a usar as tools), sem clonar o repo:

```bash
npx -y dba-master install-agents            # claude, copilot, opencode, antigravity
npx -y dba-master install-agents --agent claude
```

Escreve o comando no dir nativo de cada agente (Claude/Copilot/Opencode/Antigravity).
Reabra/recarregue o agente. Precisa do server MCP registrado (passo acima) para as tools
existirem.

## Cortar um release (mantenedor)

A versão publicada é **derivada da tag** — não edite `version` no `package.json` à mão.

```bash
git tag v1.2.0
git push origin v1.2.0
```

O workflow [`release.yml`](../.github/workflows/release.yml) dispara na tag `v*`, roda
typecheck + test + build, ajusta a versão para `1.2.0` e faz `npm publish`.

### Pré-requisitos (uma vez)

- Repositório no GitHub com o remote configurado.
- Nome `dba-master` livre no npm. Se estiver ocupado, use escopo
  (`@usuario/dba-master`): ajuste `name` no `package.json` e o publish já sai como público
  por padrão para pacotes não escopados; para escopados adicione `--access public`.
- Secret **`NPM_TOKEN`** (Automation token do npm) em *Settings → Secrets and variables →
  Actions* do repositório.

## CI

Todo push em `main` e todo PR passam pelo [`ci.yml`](../.github/workflows/ci.yml):
checkout → Node 20 → `npm install` → `typecheck` → `test` → `build`. As mesmas etapas rodam
no release antes de publicar, então não sobe build quebrado.
