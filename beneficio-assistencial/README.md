# APD - formulário de benefício assistencial

## Estado

Frontend incluído no repositório da landing APD na rota `/beneficio-assistencial/`. O fluxo funciona no navegador, mas permanece sem backend: nenhuma resposta é salva ou enviada.

## Padrão adotado

- Formato: quiz HTML próprio, uma pergunta por tela, seguindo o mecanismo já usado em `02. KETELHIN/01. Cliente/03. Ademicon/formulario/index.html`.
- Identidade: logo APD existente, Maven Pro e a paleta já usada no site (`#E62645`, `#9C0B35`, `#1F2124`, `#F2F2F2`, branco).
- Referências verificadas: site `https://apdadvogados.com.br/`, pasta de logos do Drive indicada na task e a imagem de referência indicada na task.
- Conteúdo: somente as quatro perguntas e opções fornecidas no ClickUp, sem campos extras.

## Privacidade e limites

- Não há `fetch`, formulário de envio, pixel, analytics, cookie ou `localStorage`/`sessionStorage`.
- As escolhas existem apenas na memória da aba e são apagadas ao recarregar ou usar “Recomeçar”.
- O protótipo não promete benefício, não calcula elegibilidade e não pede CPF, contato ou upload de laudos.

## Pendências antes de ativar o envio

1. Definir o destino autorizado das respostas (CRM, webhook, grupo ou conta do serviço Typeform).
2. Definir o texto e a rota pós-envio.
3. Definir retenção, acesso e tratamento das respostas sensíveis.
4. Se a decisão mudar para a plataforma Typeform real, confirmar a conta proprietária e o plano existente; nenhuma conta ou assinatura foi criada.

## Arquivos

- `index.html` — protótipo navegável.
- `assets/logo-apd.svg` — cópia local do logo já existente no projeto APD.
