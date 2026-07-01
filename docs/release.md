# Release e uso sem o repositório

O dba-master é publicado no **npm** a cada tag. Quem não tem o repositório usa via `npx`,
sem clonar nem buildar.

## Usar sem o repositório (usuário final)

O jeito mais simples é o subcomando `install`, que registra o servidor MCP `npx -y dba-master` no config de cada agente e a skill respectiva em uma interface iterativa onde você pode escolher os agentes:

```bash
DB_USER=usuario DB_PASSWORD=senha DB_CONNECT_STRING=host:1521/service_name \
  npx -y dba-master install
```

Sem as vars no ambiente, grava placeholders `<DB_USER>` etc. para editar depois.

No Claude Code, alternativamente via CLI:

```bash
claude mcp add dba-master \
  -e DB_USER=usuario -e DB_PASSWORD=senha \
  -e DB_CONNECT_STRING=host:1521/service_name \
  -- npx -y dba-master
```

Ou config manual em qualquer cliente MCP:

```jsonc
{
  "command": "npx",
  "args": ["-y", "dba-master"],
  "env": {
    "DB_USER": "usuario",
    "DB_PASSWORD": "senha",
    "DB_CONNECT_STRING": "host:1521/service_name"
  }
}
```

Modo **thin** (default) não exige Oracle Instant Client. Variáveis completas em
[instalacao.md](instalacao.md).



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
