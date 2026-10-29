# APD - formulário de benefício assistencial

## Estado

Formulário publicado na rota `/beneficio-assistencial/`, com backend no mesmo
projeto Vercel em `POST /api/beneficio-assistencial`.

O mesmo caminho também funciona no projeto Cloudflare Pages isolado. Nesse
ambiente, `functions/api/beneficio-assistencial.js` grava as respostas no D1
`apd-landing-tracking-db` e relaciona o envio ao evento `Lead` pelo
`event_id`. A implantação da Vercel permanece disponível como rollback.

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
- `../functions/api/beneficio-assistencial.js` - Pages Function que grava no D1;
- `assets/` - logos oficiais usados no formulário.

Na Cloudflare, o evento genérico `Lead` e a atribuição de campanha são
registrados separadamente. As quatro respostas continuam fora dos payloads
enviados à Meta e ao GA4 e só aparecem no dashboard protegido `/dash`.
