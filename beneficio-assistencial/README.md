# APD - formulário de benefício assistencial

## Estado

Formulário publicado na rota `/beneficio-assistencial/`, com backend no mesmo
projeto Vercel em `POST /api/beneficio-assistencial`.

As respostas somente são confirmadas na tela depois que a Vercel Function
recebe e grava o registro em um Vercel Blob privado chamado
`apd-beneficio-assistencial`.

## Dados armazenados

Cada envio cria um JSON imutável e privado em
`beneficio-assistencial/AAAA-MM-DD/<id>.json`, contendo somente:

- ID aleatório;
- data e hora do envio;
- origem fixa `beneficio-assistencial`;
- os quatro códigos das opções marcadas (`q1` a `q4`).

Não são armazenados nome, telefone, e-mail, CPF, laudos, documentos, endereço
IP, user-agent ou outros identificadores do visitante. Os códigos de resposta
não são enviados a pixels, analytics, CAPI ou LiderHub.

## Proteções

- armazenamento Blob privado;
- escrita somente pela Function autenticada via OIDC da Vercel;
- validação estrita das opções permitidas;
- limite de 4 KiB por requisição;
- validação de mesma origem;
- campo honeypot para reduzir spam;
- resposta `no-store` e sem retorno da URL privada do registro.

## Arquivos

- `index.html` - interface do formulário e envio para a API;
- `../api/beneficio-assistencial.js` - Vercel Function de validação e gravação;
- `assets/` - logos oficiais usados no formulário.
