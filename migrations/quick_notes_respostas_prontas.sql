-- Importa as "respostas prontas" (macros) da planilha respostas_prontas.xls para
-- quick_notes, usando SÓ a coluna "Texto da resposta predefinida". O título
-- (coluna shortcut) é gerado do começo do texto, porque a planilha não tem um
-- título próprio (a coluna Nome repete o texto).
--
-- Aditiva e idempotente: não mexe no que já existe; não insere uma resposta cujo
-- texto já esteja cadastrado; marca tudo com category = 'Respostas prontas' —
-- pra desfazer: DELETE FROM public.quick_notes WHERE category = 'Respostas prontas';

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Para abrir um chamado preencha esse formulário por favor ➡️…$qn$, $qn$Para abrir um chamado preencha esse formulário por favor ➡️ https://systemsat.bitrix24.site/suporte/$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Para abrir um chamado preencha esse formulário por favor ➡️ https://systemsat.bitrix24.site/suporte/$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Gostaríamos de saber como foi o nosso atendimento. Sua opinião é muito…$qn$, $qn$Gostaríamos de saber como foi o nosso atendimento.
Sua opinião é muito importante e o questionário leva menos de 2 minutos.

Clique aqui para avaliar: https://forms.gle/ET6Z2G6aFLhZAdPT6

Agradecemos sua participação!$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Gostaríamos de saber como foi o nosso atendimento.
Sua opinião é muito importante e o questionário leva menos de 2 minutos.

Clique aqui para avaliar: https://forms.gle/ET6Z2G6aFLhZAdPT6

Agradecemos sua participação!$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Olá! Sou o Rodolfo, suporte Systemsat. Tudo bem ? Referente ao ticket:$qn$, $qn$Olá!
Sou o Rodolfo, suporte Systemsat.
Tudo bem ?
Referente ao ticket:$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Olá!
Sou o Rodolfo, suporte Systemsat.
Tudo bem ?
Referente ao ticket:$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Aqui está a documentação para nossas APIs Este é um manual de utilização para a…$qn$, $qn$Aqui está a documentação para nossas APIs

Este é um manual de utilização para a central
https://docs.google.com/document/u/1/d/e/2PACX-1vTPATjkvOL6OWlzGjrmLPA2YxpV84nr1D0eV-YFdA8VqhAX2rmQtROpUCtfHxQshg0ifbIthMlbN5NB/pub

O SSX Administration Integration é utilizado para integração da central:
https://integration.systemsatx.com.br/index.html?urls.primaryName=SSX_Administration_Integration

Para as integrações do cliente, utilize o SSX Tracking Integration
https://integration.systemsatx.com.br/index.html?urls.primaryName=SSX_Tracking_Integration$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Aqui está a documentação para nossas APIs

Este é um manual de utilização para a central
https://docs.google.com/document/u/1/d/e/2PACX-1vTPATjkvOL6OWlzGjrmLPA2YxpV84nr1D0eV-YFdA8VqhAX2rmQtROpUCtfHxQshg0ifbIthMlbN5NB/pub

O SSX Administration Integration é utilizado para integração da central:
https://integration.systemsatx.com.br/index.html?urls.primaryName=SSX_Administration_Integration

Para as integrações do cliente, utilize o SSX Tracking Integration
https://integration.systemsatx.com.br/index.html?urls.primaryName=SSX_Tracking_Integration$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Para que possamos dar continuidade à análise, por favor, informe os seguintes…$qn$, $qn$Para que possamos dar continuidade à análise, por favor, informe os seguintes dados referentes à integração com a API:

• URL da API utilizada
• Credenciais de acesso (login e senha)
• Método(s) utilizado(s)
• Parâmetros enviados na requisição

Caso possível, inclua também um exemplo de chamada ou trecho de código utilizado na integração.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Para que possamos dar continuidade à análise, por favor, informe os seguintes dados referentes à integração com a API:

• URL da API utilizada
• Credenciais de acesso (login e senha)
• Método(s) utilizado(s)
• Parâmetros enviados na requisição

Caso possível, inclua também um exemplo de chamada ou trecho de código utilizado na integração.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Precisamos de algumas informações importantes para aprofundarmos a analise •…$qn$, $qn$Precisamos de algumas informações importantes para aprofundarmos a analise

• Usuário do problema (Senha se possível)
• Modelo do Aparelho
• Versão do Android ou iOS
• Versão atual do APP
• Print da tela de permissões do app (configurações > Apps > SSX Mobile > Permissões)

Peço que retorne com essas informações para avançarmos na analise do problema.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Precisamos de algumas informações importantes para aprofundarmos a analise

• Usuário do problema (Senha se possível)
• Modelo do Aparelho
• Versão do Android ou iOS
• Versão atual do APP
• Print da tela de permissões do app (configurações > Apps > SSX Mobile > Permissões)

Peço que retorne com essas informações para avançarmos na analise do problema.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Precisamos de algumas informações importantes para aprofundarmos a analise •… (2)$qn$, $qn$Precisamos de algumas informações importantes para aprofundarmos a analise

• Usuário do problema (Senha se possível)
• Nome do app Onboard cadastrado no SSX
• Modelo do Aparelho
• Versão do Android
• Print da tela de permissões do app (configurações > Apps > SSX Onboard > Permissões)

Peço que retorne com essas informações para avançarmos na analise do problema.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Precisamos de algumas informações importantes para aprofundarmos a analise

• Usuário do problema (Senha se possível)
• Nome do app Onboard cadastrado no SSX
• Modelo do Aparelho
• Versão do Android
• Print da tela de permissões do app (configurações > Apps > SSX Onboard > Permissões)

Peço que retorne com essas informações para avançarmos na analise do problema.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Você pode visualizar as posições no Google My Maps de forma simples. Siga estes…$qn$, $qn$Você pode visualizar as posições no Google My Maps de forma simples. Siga estes passos:

- Acesse Google My Maps.
- Crie um novo mapa e selecione "Importar".
- Carregue o arquivo da planilha e mapeie as colunas de latitude e longitude.

O mapa será gerado com os pontos do percurso. Clicando no ícone da posição você terá os detalhes de eventos, horas etc..$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Você pode visualizar as posições no Google My Maps de forma simples. Siga estes passos:

- Acesse Google My Maps.
- Crie um novo mapa e selecione "Importar".
- Carregue o arquivo da planilha e mapeie as colunas de latitude e longitude.

O mapa será gerado com os pontos do percurso. Clicando no ícone da posição você terá os detalhes de eventos, horas etc..$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Distância (Odo): Refere-se à distância registrada pelo odômetro do veículo…$qn$, $qn$Distância (Odo):
Refere-se à distância registrada pelo odômetro do veículo, sendo um valor enviado diretamente pelo rastreador.
Esse dado costuma ser mais preciso, já que é gerado pelo próprio equipamento instalado no veículo.

Distância (GPS):
Calculada dentro do sistema com base nas posições fornecidas pelo GPS.
Embora menos precisa, essa medida pode ser útil como referência, especialmente em casos em que o odômetro não esteja enviando informações corretamente.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Distância (Odo):
Refere-se à distância registrada pelo odômetro do veículo, sendo um valor enviado diretamente pelo rastreador.
Esse dado costuma ser mais preciso, já que é gerado pelo próprio equipamento instalado no veículo.

Distância (GPS):
Calculada dentro do sistema com base nas posições fornecidas pelo GPS.
Embora menos precisa, essa medida pode ser útil como referência, especialmente em casos em que o odômetro não esteja enviando informações corretamente.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Informamos que não é possível realizar a transferência de titularidade de um…$qn$, $qn$Informamos que não é possível realizar a transferência de titularidade de um veículo já cadastrado para outro cliente na plataforma. Essa restrição existe por motivos legais, conforme determina a Lei Geral de Proteção de Dados Pessoais (LGPD – Lei nº 13.709/2018).

Ao realizar essa troca, o novo titular teria acesso a todo o histórico de rastreamento gerado enquanto o veículo estava sob responsabilidade do cliente anterior. Isso inclui dados como localizações, trajetos e horários, o que configura uso indevido de dados pessoais.

A LGPD, em seus Art. 6º, incisos I e VII, estabelece que:

● Os dados devem ser utilizados apenas para a finalidade legítima informada ao titular original;

● Devem ser protegidos contra acessos não autorizados.

Por isso, não é permitido transferir o histórico de um cliente para outro.

✅ Como proceder:

Caso o veículo tenha mudado de proprietário, recomendamos:

1. Inativar o cadastro atual do veículo, ou remova o vinculo entre o rastreador e o veículo caso não deseje perder o histórico;

2. Realizar um novo cadastro, agora vinculado ao novo cliente.

Dessa forma, garantimos a conformidade com a legislação e a segurança das informações de todos os envolvidos.

Estamos à disposição para ajudar no que for preciso.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Informamos que não é possível realizar a transferência de titularidade de um veículo já cadastrado para outro cliente na plataforma. Essa restrição existe por motivos legais, conforme determina a Lei Geral de Proteção de Dados Pessoais (LGPD – Lei nº 13.709/2018).

Ao realizar essa troca, o novo titular teria acesso a todo o histórico de rastreamento gerado enquanto o veículo estava sob responsabilidade do cliente anterior. Isso inclui dados como localizações, trajetos e horários, o que configura uso indevido de dados pessoais.

A LGPD, em seus Art. 6º, incisos I e VII, estabelece que:

● Os dados devem ser utilizados apenas para a finalidade legítima informada ao titular original;

● Devem ser protegidos contra acessos não autorizados.

Por isso, não é permitido transferir o histórico de um cliente para outro.

✅ Como proceder:

Caso o veículo tenha mudado de proprietário, recomendamos:

1. Inativar o cadastro atual do veículo, ou remova o vinculo entre o rastreador e o veículo caso não deseje perder o histórico;

2. Realizar um novo cadastro, agora vinculado ao novo cliente.

Dessa forma, garantimos a conformidade com a legislação e a segurança das informações de todos os envolvidos.

Estamos à disposição para ajudar no que for preciso.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Encaminhei este caso para seu pós vendas, que entrará em contato o quanto…$qn$, $qn$Encaminhei este caso para seu pós vendas, que entrará em contato o quanto antes.
Caso você não possua o número dele, segue o link para contato no Whatsapp
Clarice - https://wa.me/5521973653933$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Encaminhei este caso para seu pós vendas, que entrará em contato o quanto antes.
Caso você não possua o número dele, segue o link para contato no Whatsapp
Clarice - https://wa.me/5521973653933$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Podemos ver os equipamentos implementados e funções compatíveis no SSX em…$qn$, $qn$Podemos ver os equipamentos implementados e funções compatíveis no SSX em: Administração > Hardware > Modelos de rastreador$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Podemos ver os equipamentos implementados e funções compatíveis no SSX em: Administração > Hardware > Modelos de rastreador$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Temos um artigo na Universidade Systemsat que vai te ajudar. Você pode…$qn$, $qn$Temos um artigo na Universidade Systemsat que vai te ajudar.
Você pode acessá-lo no link abaixo:

🔗 [Cole o link aqui]

Se precisar de mais alguma coisa, fico à disposição!$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Temos um artigo na Universidade Systemsat que vai te ajudar.
Você pode acessá-lo no link abaixo:

🔗 [Cole o link aqui]

Se precisar de mais alguma coisa, fico à disposição!$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Atualmente nosso canal financeiro utiliza outro contato. Utilize o link para…$qn$, $qn$Atualmente nosso canal financeiro utiliza outro contato.
Utilize o link para contato direto com o WhatsApp do nosso time financeiro.

https://wa.me/5521994194821$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Atualmente nosso canal financeiro utiliza outro contato.
Utilize o link para contato direto com o WhatsApp do nosso time financeiro.

https://wa.me/5521994194821$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Identificamos uma pendência financeira em seu cadastro, e por isso sua central…$qn$, $qn$Identificamos uma pendência financeira em seu cadastro, e por isso sua central encontra-se temporariamente indisponível.
Peço que entre em contato com nosso setor financeiro para mais detalhes através através do contato: https://wa.me/5521994194821$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Identificamos uma pendência financeira em seu cadastro, e por isso sua central encontra-se temporariamente indisponível.
Peço que entre em contato com nosso setor financeiro para mais detalhes através através do contato: https://wa.me/5521994194821$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$O motivo de um veículo não aparecer para ser selecionado em uma regra, indica…$qn$, $qn$O motivo de um veículo não aparecer para ser selecionado em uma regra, indica que a regra contém algum elemento que o protocolo do rastreador não possui.

Geralmente isso ocorre com o evento de controle.
No vídeo a seguir explicamos como resolver esse caso, cadastrando corretamente o evento de controle
https://youtu.be/_PoIvbGTIQs$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$O motivo de um veículo não aparecer para ser selecionado em uma regra, indica que a regra contém algum elemento que o protocolo do rastreador não possui.

Geralmente isso ocorre com o evento de controle.
No vídeo a seguir explicamos como resolver esse caso, cadastrando corretamente o evento de controle
https://youtu.be/_PoIvbGTIQs$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Quando um equipamento não está se comunicando com a plataforma, o primeiro…$qn$, $qn$Quando um equipamento não está se comunicando com a plataforma, o primeiro passo recomendado é ativar o debug no sistema. Essa ferramenta nos permite verificar se o equipamento está enviando algum dado ao nosso gateway. Se o equipamento ainda nunca comunicou conosco, é essencial ativar o debug para o gateway correspondente à porta configurada no rastreador. Você pode seguir o passo a passo detalhado no link abaixo para ativar o debug no sistema SSX: 🔗 https://sites.google.com/systemsat.com.br/universidade/wiki/administra%C3%A7%C3%A3o/debugs Importante: Caso haja outros equipamentos comunicando normalmente nessa mesma porta, isso indica que o gateway está funcionando corretamente e que o problema está no próprio rastreador, que não está enviando dados ao sistema.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Quando um equipamento não está se comunicando com a plataforma, o primeiro passo recomendado é ativar o debug no sistema. Essa ferramenta nos permite verificar se o equipamento está enviando algum dado ao nosso gateway. Se o equipamento ainda nunca comunicou conosco, é essencial ativar o debug para o gateway correspondente à porta configurada no rastreador. Você pode seguir o passo a passo detalhado no link abaixo para ativar o debug no sistema SSX: 🔗 https://sites.google.com/systemsat.com.br/universidade/wiki/administra%C3%A7%C3%A3o/debugs Importante: Caso haja outros equipamentos comunicando normalmente nessa mesma porta, isso indica que o gateway está funcionando corretamente e que o problema está no próprio rastreador, que não está enviando dados ao sistema.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Se você tiver uma sugestão/ideia de melhoria, pode nos enviar pelo formulário…$qn$, $qn$Se você tiver uma sugestão/ideia de melhoria, pode nos enviar pelo formulário abaixo.
Vamos direcionar para análise do produto e avaliar a viabilidade no momento oportuno

https://docs.google.com/forms/d/e/1FAIpQLSeVEpYMr9oJ5AKmzW95se_W6kuU4x8YuWsAhRXKD80-RJKjGw/viewform$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Se você tiver uma sugestão/ideia de melhoria, pode nos enviar pelo formulário abaixo.
Vamos direcionar para análise do produto e avaliar a viabilidade no momento oportuno

https://docs.google.com/forms/d/e/1FAIpQLSeVEpYMr9oJ5AKmzW95se_W6kuU4x8YuWsAhRXKD80-RJKjGw/viewform$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Segue o contato via Whatsapp do suporte JIMI https://wa.me/551138681855$qn$, $qn$Segue o contato via Whatsapp do suporte JIMI
https://wa.me/551138681855$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Segue o contato via Whatsapp do suporte JIMI
https://wa.me/551138681855$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Gerei um link para falarmos https://meet.google.com/yrf-ypoh-gxp$qn$, $qn$Gerei um link para falarmos

https://meet.google.com/yrf-ypoh-gxp$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Gerei um link para falarmos

https://meet.google.com/yrf-ypoh-gxp$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Qual seu melhor email para chamados e o número de retorno do Whatsapp?$qn$, $qn$Qual seu melhor email para chamados e o número de retorno do Whatsapp?$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Qual seu melhor email para chamados e o número de retorno do Whatsapp?$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Caso você identifique algum erro nos endereços exibidos na plataforma, é…$qn$, $qn$Caso você identifique algum erro nos endereços exibidos na plataforma, é importante esclarecer que essas informações são fornecidas por um serviço externo de mapas, e eventuais inconsistências são provenientes do fornecedor de endereços utilizado.

Se o mapa em uso for o OpenStreetMap, vale lembrar que ele é um sistema gratuito e colaborativo. As correções e atualizações são feitas diretamente pelos próprios usuários. Caso queira sugerir uma alteração, você pode fazer isso diretamente pelo site, acessando o seguinte link:

🔗 https://www.openstreetmap.org/fixthemap

Como alternativa, também é possível contratar outro fornecedor de endereço que esteja disponível na plataforma. Para isso, entre em contato com o seu responsável de pós-vendas para mais informações sobre as opções disponíveis.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Caso você identifique algum erro nos endereços exibidos na plataforma, é importante esclarecer que essas informações são fornecidas por um serviço externo de mapas, e eventuais inconsistências são provenientes do fornecedor de endereços utilizado.

Se o mapa em uso for o OpenStreetMap, vale lembrar que ele é um sistema gratuito e colaborativo. As correções e atualizações são feitas diretamente pelos próprios usuários. Caso queira sugerir uma alteração, você pode fazer isso diretamente pelo site, acessando o seguinte link:

🔗 https://www.openstreetmap.org/fixthemap

Como alternativa, também é possível contratar outro fornecedor de endereço que esteja disponível na plataforma. Para isso, entre em contato com o seu responsável de pós-vendas para mais informações sobre as opções disponíveis.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Essa mensagem indica que o e-mail do usuário já está cadastrado no SSX, mesmo…$qn$, $qn$Essa mensagem indica que o e-mail do usuário já está cadastrado no SSX, mesmo que ele não apareça vinculado à sua central. Isso acontece porque o usuário provavelmente já foi cliente de outro parceiro nosso e, por isso, o e-mail já existe no sistema.

Nesses casos, há duas opções:

Solicitar que o usuário informe um e-mail diferente para o cadastro; ou

Orientá-lo a entrar em contato com o antigo cliente (a central anterior) para que seja feita a exclusão do e-mail.

Infelizmente, essa exclusão não pode ser feita diretamente por nós, já que o e-mail está vinculado a outra conta do sistema.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Essa mensagem indica que o e-mail do usuário já está cadastrado no SSX, mesmo que ele não apareça vinculado à sua central. Isso acontece porque o usuário provavelmente já foi cliente de outro parceiro nosso e, por isso, o e-mail já existe no sistema.

Nesses casos, há duas opções:

Solicitar que o usuário informe um e-mail diferente para o cadastro; ou

Orientá-lo a entrar em contato com o antigo cliente (a central anterior) para que seja feita a exclusão do e-mail.

Infelizmente, essa exclusão não pode ser feita diretamente por nós, já que o e-mail está vinculado a outra conta do sistema.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Encaminhei este caso para seu pós vendas, que entrará em contato o quanto… (2)$qn$, $qn$Encaminhei este caso para seu pós vendas, que entrará em contato o quanto antes.
Caso você não possua o número dele, segue o link para contato no Whatsapp
Rafaela - https://wa.me/5521993101612$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Encaminhei este caso para seu pós vendas, que entrará em contato o quanto antes.
Caso você não possua o número dele, segue o link para contato no Whatsapp
Rafaela - https://wa.me/5521993101612$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Para corrigir o odômetro, existem duas formas possíveis: Opção 1 – Enviar um…$qn$, $qn$Para corrigir o odômetro, existem duas formas possíveis:

Opção 1 – Enviar um comando ao rastreador
A forma mais indicada é enviar um comando que altere o valor que o rastreador transmite ao sistema. Para isso:

Acesse o cadastro do rastreador.

Verifique se existe um comando disponível no sistema para realizar a alteração do odômetro.

Caso o comando não esteja disponível, você pode consultar o fabricante do equipamento e solicitar um comando livre que atenda a essa necessidade. Esse comando também pode ser enviado pela mesma tela de comandos.

👉 Veja aqui um vídeo com o passo a passo para envio de comandos:
https://www.youtube.com/watch?v=q-JA5XxRqVo

🛠️ Opção 2 – Aplicar correção no sistema (sem alterar o valor enviado)
Você também pode utilizar a funcionalidade de correção do odômetro, que ajusta o valor mostrado no sistema com base em um cálculo, sem alterar o valor que o rastreador envia.

Para isso, consulte a documentação abaixo, a partir da seção “Opção 2: Ajustar os Valores Diretamente no SSX”:

https://universidadesystemsat.com.br/conteudos-adicionais/correcao-odometro-horimetro$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Para corrigir o odômetro, existem duas formas possíveis:

Opção 1 – Enviar um comando ao rastreador
A forma mais indicada é enviar um comando que altere o valor que o rastreador transmite ao sistema. Para isso:

Acesse o cadastro do rastreador.

Verifique se existe um comando disponível no sistema para realizar a alteração do odômetro.

Caso o comando não esteja disponível, você pode consultar o fabricante do equipamento e solicitar um comando livre que atenda a essa necessidade. Esse comando também pode ser enviado pela mesma tela de comandos.

👉 Veja aqui um vídeo com o passo a passo para envio de comandos:
https://www.youtube.com/watch?v=q-JA5XxRqVo

🛠️ Opção 2 – Aplicar correção no sistema (sem alterar o valor enviado)
Você também pode utilizar a funcionalidade de correção do odômetro, que ajusta o valor mostrado no sistema com base em um cálculo, sem alterar o valor que o rastreador envia.

Para isso, consulte a documentação abaixo, a partir da seção “Opção 2: Ajustar os Valores Diretamente no SSX”:

https://universidadesystemsat.com.br/conteudos-adicionais/correcao-odometro-horimetro$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Encaminhei este caso para seu pós vendas, que entrará em contato o quanto… (3)$qn$, $qn$Encaminhei este caso para seu pós vendas, que entrará em contato o quanto antes.
Caso você não possua o número dele, segue o link para contato no Whatsapp https://wa.me/5521999722862$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Encaminhei este caso para seu pós vendas, que entrará em contato o quanto antes.
Caso você não possua o número dele, segue o link para contato no Whatsapp https://wa.me/5521999722862$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Encaminhei este caso para seu pós vendas, que entrará em contato o quanto… (4)$qn$, $qn$Encaminhei este caso para seu pós vendas, que entrará em contato o quanto antes.
Caso você não possua o número dele, segue o link para contato no Whatsapp
Luiz - https://wa.me/5521999722862$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Encaminhei este caso para seu pós vendas, que entrará em contato o quanto antes.
Caso você não possua o número dele, segue o link para contato no Whatsapp
Luiz - https://wa.me/5521999722862$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Para seguir com a solicitação leia nossa politica de backup com atenção: - Não…$qn$, $qn$Para seguir com a solicitação leia nossa politica de backup com atenção:

- Não é possível realizar backups de unidades excluídas ou recadastradas.

- Atente-se ao tempo de backup offline que usa central tem em contrato, dados além desse período também não podem ser recuperados.
- Verifique se as posições realmente não estão online ainda, seja no histórico ou em relatórios como o BDV

As posições sem motoristas retornarão com o campo "motorista" vazios ou "Null"

As posições retornam via planilha e os dados que não foram gerados online não poderão ser gerados agora.
As posições sem endereço retornarão com o campo endereço vazio, mas você terá a lat/long para consulta.

Nosso SLA é de até 15 dias úteis, em casos jurídicos podemos dar prioridade, porém mantemos o SLA de até 15 dias.

Obs: Períodos mais longos podem afetar o SLA.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Para seguir com a solicitação leia nossa politica de backup com atenção:

- Não é possível realizar backups de unidades excluídas ou recadastradas.

- Atente-se ao tempo de backup offline que usa central tem em contrato, dados além desse período também não podem ser recuperados.
- Verifique se as posições realmente não estão online ainda, seja no histórico ou em relatórios como o BDV

As posições sem motoristas retornarão com o campo "motorista" vazios ou "Null"

As posições retornam via planilha e os dados que não foram gerados online não poderão ser gerados agora.
As posições sem endereço retornarão com o campo endereço vazio, mas você terá a lat/long para consulta.

Nosso SLA é de até 15 dias úteis, em casos jurídicos podemos dar prioridade, porém mantemos o SLA de até 15 dias.

Obs: Períodos mais longos podem afetar o SLA.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Na nossa API, existe um método que retorna as posições dos veículos. Cada…$qn$, $qn$Na nossa API, existe um método que retorna as posições dos veículos. Cada posição tem várias informações, como: latitude, longitude, velocidade, dados do veículo, telemetrias e também um identificador único chamado ID Position.

Esse identificador funciona como um “número de referência” de cada posição.
O que você pode fazer é usar esse número como filtro para sempre buscar apenas as posições mais novas que chegarem.

Funciona assim:

Você faz a primeira consulta e pega o ID Position mais recente.

Na próxima consulta, você pede apenas as posições com ID maior que esse último.

Repetindo esse processo em looping, você consegue ir trazendo as posições automaticamente, sem precisar buscar tudo de novo a cada vez.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Na nossa API, existe um método que retorna as posições dos veículos. Cada posição tem várias informações, como: latitude, longitude, velocidade, dados do veículo, telemetrias e também um identificador único chamado ID Position.

Esse identificador funciona como um “número de referência” de cada posição.
O que você pode fazer é usar esse número como filtro para sempre buscar apenas as posições mais novas que chegarem.

Funciona assim:

Você faz a primeira consulta e pega o ID Position mais recente.

Na próxima consulta, você pede apenas as posições com ID maior que esse último.

Repetindo esse processo em looping, você consegue ir trazendo as posições automaticamente, sem precisar buscar tudo de novo a cada vez.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Encaminhei este caso para seu pós vendas, que entrará em contato o quanto… (5)$qn$, $qn$Encaminhei este caso para seu pós vendas, que entrará em contato o quanto antes.
Caso você não possua o número dele, segue o link para contato no Whatsapp
Jeferson- https://wa.me/5521992078239$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Encaminhei este caso para seu pós vendas, que entrará em contato o quanto antes.
Caso você não possua o número dele, segue o link para contato no Whatsapp
Jeferson- https://wa.me/5521992078239$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$É necessário realizar algumas verificações e configurações para o funcionamento…$qn$, $qn$É necessário realizar algumas verificações e configurações para o funcionamento do reconhecimento facial no SSX:

1.1 – Firmware da câmera
deve estar atualizado para a versão superior à 5.1.2).

1.2 – Configuração do Proxy
O proxy deve estar corretamente direcionado para o Hat-Cloud. (Hat-Cloud)

1.3 – Cadastro do rastreador no SSX
O Cadastro deve estar atualizado no SSX, garantido total sincronia com o Hat-Cloud.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$É necessário realizar algumas verificações e configurações para o funcionamento do reconhecimento facial no SSX:

1.1 – Firmware da câmera
deve estar atualizado para a versão superior à 5.1.2).

1.2 – Configuração do Proxy
O proxy deve estar corretamente direcionado para o Hat-Cloud. (Hat-Cloud)

1.3 – Cadastro do rastreador no SSX
O Cadastro deve estar atualizado no SSX, garantido total sincronia com o Hat-Cloud.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Para que possamos analisar o caminho da conexão até nosso servidor e…$qn$, $qn$Para que possamos analisar o caminho da conexão até nosso servidor e identificar possíveis falhas, lentidão ou perdas de rota, precisamos que você realize o teste abaixo e nos envie um print do resultado completo.

Passo a passo no Windows:

1 - Pressione Windows + R
2 - Digite cmd e pressione Enter
3 - Na tela preta (Prompt de Comando), digite o comando abaixo e pressione Enter:

tracert 200.152.62.1

4 - Aguarde o teste finalizar (pode levar alguns segundos)
5 - Após concluir, tire um print da tela inteira, mostrando todo o resultado
6 - Envie o print para nós para análise

Peço também que acesse https://meuip.com.br/ e me envie um print com os dados retornados.

Dessa forma teremos os dados parra seguir as analises.

Caso tenha qualquer dificuldade, é só nos avisar.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Para que possamos analisar o caminho da conexão até nosso servidor e identificar possíveis falhas, lentidão ou perdas de rota, precisamos que você realize o teste abaixo e nos envie um print do resultado completo.

Passo a passo no Windows:

1 - Pressione Windows + R
2 - Digite cmd e pressione Enter
3 - Na tela preta (Prompt de Comando), digite o comando abaixo e pressione Enter:

tracert 200.152.62.1

4 - Aguarde o teste finalizar (pode levar alguns segundos)
5 - Após concluir, tire um print da tela inteira, mostrando todo o resultado
6 - Envie o print para nós para análise

Peço também que acesse https://meuip.com.br/ e me envie um print com os dados retornados.

Dessa forma teremos os dados parra seguir as analises.

Caso tenha qualquer dificuldade, é só nos avisar.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Temos uma alternativa para gerar o endereço a partir de latitude e longitude…$qn$, $qn$Temos uma alternativa para gerar o endereço a partir de latitude e longitude usando o Google Planilhas.

Essa função converte automaticamente as coordenadas em endereço (rua, cidade, estado etc.), preenchendo a coluna Endereço.

Importante: não é uma solução nossa. É um recurso do próprio Google Planilhas, e não conseguimos oferecer suporte, nem garantir funcionamento, limites ou disponibilidade.

Como usar

1 - A planilha deve ter as colunas Latitude, Longitude e Endereço
2 - Abra a planilha no Google Planilhas
3 - Acesse Extensões → Apps Script
4 - Apague qualquer conteúdo e cole o script abaixo
5 - Salve

function GERAR_ENDERECO(latitude, longitude) {
if (!latitude || !longitude) return "";

try {
var response = Maps.newGeocoder().reverseGeocode(latitude, longitude);
if (response.status === "OK" && response.results.length > 0) {
return response.results[0].formatted_address;
} else {
return "Endereço não encontrado";
}
} catch (e) {
return "Erro ao gerar endereço";
}
}

6 - Volte para a planilha e, na coluna Endereço, use:

=GERAR_ENDERECO(L2; M2)

7- Arraste a fórmula para as demais linhas

Limites:

O Google possui limite diário de consultas por conta, cada linha consome 1 consulta.
O limite reinicia automaticamente a cada 24 horas

É uma solução prática para gerar endereços em backups ou planilhas pontuais, usando apenas recursos do Google.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Temos uma alternativa para gerar o endereço a partir de latitude e longitude usando o Google Planilhas.

Essa função converte automaticamente as coordenadas em endereço (rua, cidade, estado etc.), preenchendo a coluna Endereço.

Importante: não é uma solução nossa. É um recurso do próprio Google Planilhas, e não conseguimos oferecer suporte, nem garantir funcionamento, limites ou disponibilidade.

Como usar

1 - A planilha deve ter as colunas Latitude, Longitude e Endereço
2 - Abra a planilha no Google Planilhas
3 - Acesse Extensões → Apps Script
4 - Apague qualquer conteúdo e cole o script abaixo
5 - Salve

function GERAR_ENDERECO(latitude, longitude) {
if (!latitude || !longitude) return "";

try {
var response = Maps.newGeocoder().reverseGeocode(latitude, longitude);
if (response.status === "OK" && response.results.length > 0) {
return response.results[0].formatted_address;
} else {
return "Endereço não encontrado";
}
} catch (e) {
return "Erro ao gerar endereço";
}
}

6 - Volte para a planilha e, na coluna Endereço, use:

=GERAR_ENDERECO(L2; M2)

7- Arraste a fórmula para as demais linhas

Limites:

O Google possui limite diário de consultas por conta, cada linha consome 1 consulta.
O limite reinicia automaticamente a cada 24 horas

É uma solução prática para gerar endereços em backups ou planilhas pontuais, usando apenas recursos do Google.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Protocolo Hikvision É o protocolo antigo, usado nas integrações legadas. Deve…$qn$, $qn$Protocolo Hikvision
É o protocolo antigo, usado nas integrações legadas. Deve ser utilizado apenas em casos específicos, como:

● câmeras mais antigas
● equipamentos G4
● câmeras não automotivas (ex.: bodycam)

Protocolo HAT Cloud
É o protocolo mais novo e recomendado. Ele utiliza a HAT Cloud, que é um gateway em nuvem da própria Hikvision, responsável por fazer a comunicação entre o SSX e as câmeras.

Para utilizá-lo, a câmera precisa ter firmware atualizado e configurar a câmera apontando para a HAT CLOUD.
A utilização desse gateway irá trazer mais estabilidade e simetria com testes em outra plataformas.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Protocolo Hikvision
É o protocolo antigo, usado nas integrações legadas. Deve ser utilizado apenas em casos específicos, como:

● câmeras mais antigas
● equipamentos G4
● câmeras não automotivas (ex.: bodycam)

Protocolo HAT Cloud
É o protocolo mais novo e recomendado. Ele utiliza a HAT Cloud, que é um gateway em nuvem da própria Hikvision, responsável por fazer a comunicação entre o SSX e as câmeras.

Para utilizá-lo, a câmera precisa ter firmware atualizado e configurar a câmera apontando para a HAT CLOUD.
A utilização desse gateway irá trazer mais estabilidade e simetria com testes em outra plataformas.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Peço que avalie o meu atendimento e tenha uma boa tarde$qn$, $qn$Peço que avalie o meu atendimento e tenha uma boa tarde$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Peço que avalie o meu atendimento e tenha uma boa tarde$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Obrigado pelo contato! Vou encerrar o atendimento, mas seguimos à disposição.…$qn$, $qn$Obrigado pelo contato! Vou encerrar o atendimento, mas seguimos à disposição.

Se puder avaliar o meu atendimento, agradeço! 🙂$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Obrigado pelo contato! Vou encerrar o atendimento, mas seguimos à disposição.

Se puder avaliar o meu atendimento, agradeço! 🙂$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Bom dia. Tudo bem? Como posso ajudar ?$qn$, $qn$Bom dia. Tudo bem?
Como posso ajudar ?$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Bom dia. Tudo bem?
Como posso ajudar ?$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Ficou alguma dúvida? Ajudo em algo mais ?$qn$, $qn$Ficou alguma dúvida?
Ajudo em algo mais ?$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Ficou alguma dúvida?
Ajudo em algo mais ?$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$O SSX valida se o domínio possui um MX Válido. Basta informar ao cliente que…$qn$, $qn$O SSX valida se o domínio possui um MX Válido.
Basta informar ao cliente que ele precisa configurar o MX passado pelo fornecedor de email em sua Zona DNS.
São procedimentos no email do cliente, o SSX apenas válido se está tudo certo.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$O SSX valida se o domínio possui um MX Válido.
Basta informar ao cliente que ele precisa configurar o MX passado pelo fornecedor de email em sua Zona DNS.
São procedimentos no email do cliente, o SSX apenas válido se está tudo certo.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Se puder, peço que avalie meu atendimento ao final ;) Leva apenas 5 segundos e…$qn$, $qn$Se puder, peço que avalie meu atendimento ao final ;)
Leva apenas 5 segundos e ajuda muito nosso time.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Se puder, peço que avalie meu atendimento ao final ;)
Leva apenas 5 segundos e ajuda muito nosso time.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Informamos que o chamado referente à sua solicitação foi aberto e já está em…$qn$, $qn$Informamos que o chamado referente à sua solicitação foi aberto e já está em análise pela equipe responsável. Assim que houver atualizações, entraremos em contato.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Informamos que o chamado referente à sua solicitação foi aberto e já está em análise pela equipe responsável. Assim que houver atualizações, entraremos em contato.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Vou finalizar o atendimento por agora. Caso tenha qualquer dúvida, é só nos…$qn$, $qn$Vou finalizar o atendimento por agora. Caso tenha qualquer dúvida, é só nos enviar uma mensagem que estaremos à disposição. 👍$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Vou finalizar o atendimento por agora. Caso tenha qualquer dúvida, é só nos enviar uma mensagem que estaremos à disposição. 👍$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Olá! 😊 Identificamos que a sua avaliação não foi computada. Para que ela seja…$qn$, $qn$Olá! 😊

Identificamos que a sua avaliação não foi computada. Para que ela seja registrada corretamente, é necessário responder diretamente à mensagem de avaliação. Respostas enviadas em mensagens separadas não são contabilizadas pelo sistema.

Se possível, pedimos a gentileza de realizar a avaliação novamente. Agradecemos pelo seu feedback!$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Olá! 😊

Identificamos que a sua avaliação não foi computada. Para que ela seja registrada corretamente, é necessário responder diretamente à mensagem de avaliação. Respostas enviadas em mensagens separadas não são contabilizadas pelo sistema.

Se possível, pedimos a gentileza de realizar a avaliação novamente. Agradecemos pelo seu feedback!$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Avaliação não foi contabilizada. Por favor, envie novamente.$qn$, $qn$Avaliação não foi contabilizada.
Por favor, envie novamente.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Avaliação não foi contabilizada.
Por favor, envie novamente.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Estamos enfrentando uma instabilidade momentânea em nossos sistemas. Nossa…$qn$, $qn$Estamos enfrentando uma instabilidade momentânea em nossos sistemas. Nossa equipe já atua para normalização o mais breve possível.

Agradecemos à compreensão.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Estamos enfrentando uma instabilidade momentânea em nossos sistemas. Nossa equipe já atua para normalização o mais breve possível.

Agradecemos à compreensão.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Gostaríamos de informar que estamos enfrentando uma instabilidade momentânea em…$qn$, $qn$Gostaríamos de informar que estamos enfrentando uma instabilidade momentânea em nossos sistemas, o que pode ocasionar lentidão ou indisponibilidade temporária em alguns serviços.

Nossa equipe técnica já está atuando com prioridade para normalizar o funcionamento o mais rápido possível e minimizar qualquer impacto. Assim que a situação estiver totalmente estabilizada, enviaremos uma nova atualização.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Gostaríamos de informar que estamos enfrentando uma instabilidade momentânea em nossos sistemas, o que pode ocasionar lentidão ou indisponibilidade temporária em alguns serviços.

Nossa equipe técnica já está atuando com prioridade para normalizar o funcionamento o mais rápido possível e minimizar qualquer impacto. Assim que a situação estiver totalmente estabilizada, enviaremos uma nova atualização.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Devido à ausência de interação no momento, este atendimento será encerrado.…$qn$, $qn$Devido à ausência de interação no momento, este atendimento será encerrado.
Permanecemos à disposição para novos atendimentos sempre que necessário.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Devido à ausência de interação no momento, este atendimento será encerrado.
Permanecemos à disposição para novos atendimentos sempre que necessário.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Olá! 😊 Caso ainda precise de ajuda, é só entrar em contato que teremos prazer…$qn$, $qn$Olá! 😊

Caso ainda precise de ajuda, é só entrar em contato que teremos prazer em atendê-lo(a).

Estamos à disposição!$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Olá! 😊

Caso ainda precise de ajuda, é só entrar em contato que teremos prazer em atendê-lo(a).

Estamos à disposição!$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Segue o contato via Whatsapp do suporte SGBras https://wa.me/553732421531…$qn$, $qn$Segue o contato via Whatsapp do suporte SGBras
https://wa.me/553732421531

https://suporte.sgbras.com/$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Segue o contato via Whatsapp do suporte SGBras
https://wa.me/553732421531

https://suporte.sgbras.com/$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Bom dia. Tudo bem? Como posso ajudar?$qn$, $qn$Bom dia. Tudo bem?
Como posso ajudar?$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Bom dia. Tudo bem?
Como posso ajudar?$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$- Print do modelo do aparelho - Print da Versão do Sistema Operacional…$qn$, $qn$- Print do modelo do aparelho
- Print da Versão do Sistema Operacional (Android/iOS)
- Print da versão do APP
- Print da tela de configuração de notificação do App
- Print da Tela de permissão do app.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$- Print do modelo do aparelho
- Print da Versão do Sistema Operacional (Android/iOS)
- Print da versão do APP
- Print da tela de configuração de notificação do App
- Print da Tela de permissão do app.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Irei encerrar o atendimento devido à falta de interação. Caso ainda tenha…$qn$, $qn$Irei encerrar o atendimento devido à falta de interação. Caso ainda tenha alguma dúvida, basta retornar o contato conosco. Nosso suporte funciona 24 horas.

Desejo um ótimo final de expediente!$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Irei encerrar o atendimento devido à falta de interação. Caso ainda tenha alguma dúvida, basta retornar o contato conosco. Nosso suporte funciona 24 horas.

Desejo um ótimo final de expediente!$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Para vincular o SNE com o Gestão de Multas, siga o passo a passo abaixo…$qn$, $qn$Para vincular o SNE com o Gestão de Multas, siga o passo a passo abaixo:

- Acesse o site do SNE/Serpro.
- Entre com o certificado digital da empresa.
- Clique em “Aderir” ao SNE.
- Acesse o GOV.BR Empresas com o certificado digital.
- Clique em “Vincular empresas via e-CNPJ”.
- Selecione o CNPJ da empresa.
- Vá nos três pontinhos e clique em “Gerenciar colaboradores”.
- Informe o CPF do colaborador indicado pelo suporte e clique em “Buscar”.
- Confirme o nome, escolha a data de expiração do acesso e clique em “Cadastrar”.
- Aguarde a mensagem “Conta vinculada com sucesso!”.

Em até 48 horas, os dados dos veículos vinculados ao SNE serão captados no Gestão de Multas.

Obs.: se tiver mais de um CNPJ, o processo precisa ser feito em todos eles.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Para vincular o SNE com o Gestão de Multas, siga o passo a passo abaixo:

- Acesse o site do SNE/Serpro.
- Entre com o certificado digital da empresa.
- Clique em “Aderir” ao SNE.
- Acesse o GOV.BR Empresas com o certificado digital.
- Clique em “Vincular empresas via e-CNPJ”.
- Selecione o CNPJ da empresa.
- Vá nos três pontinhos e clique em “Gerenciar colaboradores”.
- Informe o CPF do colaborador indicado pelo suporte e clique em “Buscar”.
- Confirme o nome, escolha a data de expiração do acesso e clique em “Cadastrar”.
- Aguarde a mensagem “Conta vinculada com sucesso!”.

Em até 48 horas, os dados dos veículos vinculados ao SNE serão captados no Gestão de Multas.

Obs.: se tiver mais de um CNPJ, o processo precisa ser feito em todos eles.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Estou entrando em contato referente ao chamado$qn$, $qn$Estou entrando em contato referente ao chamado$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Estou entrando em contato referente ao chamado$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Caso ainda precise de suporte ou tenha qualquer outra solicitação, basta entrar…$qn$, $qn$Caso ainda precise de suporte ou tenha qualquer outra solicitação, basta entrar em contato conosco. Teremos prazer em ajudá-lo(a).

Estamos à disposição! 😊$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Caso ainda precise de suporte ou tenha qualquer outra solicitação, basta entrar em contato conosco. Teremos prazer em ajudá-lo(a).

Estamos à disposição! 😊$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Seguiremos a disposição para qualquer outra demanda, estamos a uma mensagem de…$qn$, $qn$Seguiremos a disposição para qualquer outra demanda, estamos a uma mensagem de distância, conte conosco.
Se puder avaliar meu atendimento me ajuda muito, obrigado!$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Seguiremos a disposição para qualquer outra demanda, estamos a uma mensagem de distância, conte conosco.
Se puder avaliar meu atendimento me ajuda muito, obrigado!$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Diga-nos como nos saímos. Basta enviar 1, se você estiver satisfeito, ou 0, se…$qn$, $qn$Diga-nos como nos saímos.

Basta enviar 1, se você estiver satisfeito, ou 0, se poderíamos fazer melhor.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Diga-nos como nos saímos.

Basta enviar 1, se você estiver satisfeito, ou 0, se poderíamos fazer melhor.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Boa tarde. Tudo bem? Como posso ajudar?$qn$, $qn$Boa tarde. Tudo bem?
Como posso ajudar?$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Boa tarde. Tudo bem?
Como posso ajudar?$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$A Nota de Condução Econômica e a Nota de Condições Seguras são calculadas com…$qn$, $qn$A Nota de Condução Econômica e a Nota de Condições Seguras são calculadas com base na fórmula de avaliação do motorista, considerando diferentes fatores relacionados ao comportamento de condução.

Nota de Condução Econômica

Essa nota avalia o desempenho do motorista em relação ao consumo de combustível. Para que o cálculo seja realizado corretamente, é necessário que o rastreador esteja integrado à rede CAN do veículo e seja capaz de coletar informações como a rotação do motor (RPM). A fórmula de avaliação deve contemplar faixas de RPM, sendo que a pontuação é atribuída conforme o percentual de tempo em que o motorista mantém o veículo dentro das faixas consideradas econômicas.

Nota de Condições Seguras

Essa nota mede o comportamento do motorista em relação à segurança na condução. São consideradas ocorrências como acelerações bruscas, freadas bruscas, curvas bruscas e excesso de velocidade. Cada infração gera uma perda de pontos, e a soma dessas ocorrências determina a nota final do motorista.

Esses indicadores são importantes para auxiliar os gestores de frota na identificação de oportunidades de melhoria, contribuindo para uma condução mais segura, eficiente e econômica.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$A Nota de Condução Econômica e a Nota de Condições Seguras são calculadas com base na fórmula de avaliação do motorista, considerando diferentes fatores relacionados ao comportamento de condução.

Nota de Condução Econômica

Essa nota avalia o desempenho do motorista em relação ao consumo de combustível. Para que o cálculo seja realizado corretamente, é necessário que o rastreador esteja integrado à rede CAN do veículo e seja capaz de coletar informações como a rotação do motor (RPM). A fórmula de avaliação deve contemplar faixas de RPM, sendo que a pontuação é atribuída conforme o percentual de tempo em que o motorista mantém o veículo dentro das faixas consideradas econômicas.

Nota de Condições Seguras

Essa nota mede o comportamento do motorista em relação à segurança na condução. São consideradas ocorrências como acelerações bruscas, freadas bruscas, curvas bruscas e excesso de velocidade. Cada infração gera uma perda de pontos, e a soma dessas ocorrências determina a nota final do motorista.

Esses indicadores são importantes para auxiliar os gestores de frota na identificação de oportunidades de melhoria, contribuindo para uma condução mais segura, eficiente e econômica.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Irei encerrar o atendimento devido ao horário mas qualquer coisa basta retornar…$qn$, $qn$Irei encerrar o atendimento devido ao horário mas qualquer coisa basta retornar contato que teremos atendentes à disposição!$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Irei encerrar o atendimento devido ao horário mas qualquer coisa basta retornar contato que teremos atendentes à disposição!$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Olá! Atualmente, não prestamos mais suporte aos produtos GS Web e GS Log. Por…$qn$, $qn$Olá!

Atualmente, não prestamos mais suporte aos produtos GS Web e GS Log. Por esse motivo, não conseguimos dar continuidade a essa tratativa.

Caso tenha qualquer dúvida ou necessidade relacionada a esses produtos, recomendamos que entre em contato com o seu consultor de pós-venda, que poderá orientá-lo da melhor forma.

Se desejar, posso encaminhar o contato para facilitar esse atendimento.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Olá!

Atualmente, não prestamos mais suporte aos produtos GS Web e GS Log. Por esse motivo, não conseguimos dar continuidade a essa tratativa.

Caso tenha qualquer dúvida ou necessidade relacionada a esses produtos, recomendamos que entre em contato com o seu consultor de pós-venda, que poderá orientá-lo da melhor forma.

Se desejar, posso encaminhar o contato para facilitar esse atendimento.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Informamos que, no momento, o sistema está apresentando instabilidade. Nossa…$qn$, $qn$Informamos que, no momento, o sistema está apresentando instabilidade. Nossa equipe já identificou a ocorrência e está atuando em caráter emergencial para identificar a causa e restabelecer a normalidade o mais rápido possível.

Estamos acompanhando a situação de forma prioritária e compartilharemos novas atualizações assim que houver um posicionamento.

Agradecemos a compreensão de todos.$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Informamos que, no momento, o sistema está apresentando instabilidade. Nossa equipe já identificou a ocorrência e está atuando em caráter emergencial para identificar a causa e restabelecer a normalidade o mais rápido possível.

Estamos acompanhando a situação de forma prioritária e compartilharemos novas atualizações assim que houver um posicionamento.

Agradecemos a compreensão de todos.$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Agora alem de verificar o rastreadores homologados no menu de administração >…$qn$, $qn$Agora alem de verificar o rastreadores homologados no menu de administração > hardware > modelos de rastreadores

tambem pode verificar neste site
https://rastreadores.systemsatlabs.com.br/$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Agora alem de verificar o rastreadores homologados no menu de administração > hardware > modelos de rastreadores

tambem pode verificar neste site
https://rastreadores.systemsatlabs.com.br/$qn$)
ON CONFLICT (shortcut) DO NOTHING;

INSERT INTO public.quick_notes (shortcut, content, category)
SELECT $qn$Como o retorno referente ao chamado já foi realizado, estaremos encerrando este…$qn$, $qn$Como o retorno referente ao chamado já foi realizado, estaremos encerrando este atendimento.

Caso tenha alguma dúvida ou precise de mais informações, estamos à disposição!$qn$, 'Respostas prontas'
WHERE NOT EXISTS (SELECT 1 FROM public.quick_notes WHERE content = $qn$Como o retorno referente ao chamado já foi realizado, estaremos encerrando este atendimento.

Caso tenha alguma dúvida ou precise de mais informações, estamos à disposição!$qn$)
ON CONFLICT (shortcut) DO NOTHING;
