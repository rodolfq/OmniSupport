@echo off
rem ============================================================
rem  SSX Desk - reconstroi a imagem e reinicia o servidor.
rem
rem  Diferenca para iniciar-ssx.bat: aquele so sobe o container se
rem  estiver parado (nao pega mudanca de codigo, so reflete o que
rem  ja esta na imagem construida). Este aqui reconstroi a imagem
rem  antes de subir - use sempre que tiver alterado o codigo e
rem  quiser ver a mudanca refletida no container.
rem
rem  Uso:  reiniciar-ssx.bat          -> reconstroi e reinicia so a aplicacao
rem        reiniciar-ssx.bat tunel    -> reconstroi e reinicia tambem o tunel
rem                                      Cloudflare (exige TUNNEL_TOKEN no .env)
rem
rem  chcp 65001 = pagina de codigo UTF-8, senao acento vira lixo no console.
rem ============================================================
chcp 65001 >nul
setlocal

set "PROJETO=%~dp0"
set "URL=http://localhost:3000"
set "PERFIL="
if /i "%~1"=="tunel" set "PERFIL=--profile tunnel"

title SSX Desk - Reiniciando

echo.
echo   ============================================
echo    SSX Desk - reconstruindo e reiniciando
echo   ============================================
echo.

cd /d "%PROJETO%"
if errorlevel 1 (
    echo   [ERRO] Nao consegui entrar na pasta do projeto:
    echo          %PROJETO%
    goto :erro
)

rem --- 1. O engine do Docker precisa estar de pe. "docker info" so
rem     responde quando ele esta pronto de verdade; a janela do Docker
rem     Desktop abrir nao significa que ja da pra usar.
echo   [1/4] Verificando o Docker...
docker info >nul 2>&1
if not errorlevel 1 goto :docker_ok

echo         Docker Desktop nao esta rodando. Abrindo...
start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
set /a ESPERA=0

rem  "ping -n N 127.0.0.1" e usado como pausa no lugar do "timeout": o timeout
rem  do Windows aborta com erro quando a entrada esta redirecionada (chamado
rem  por outro script, agendador de tarefas, etc). O ping nao depende do console.
:aguarda_docker
ping -n 4 127.0.0.1 >nul
docker info >nul 2>&1
if not errorlevel 1 goto :docker_ok
set /a ESPERA+=3
if %ESPERA% geq 180 (
    echo   [ERRO] O Docker nao subiu em 3 minutos.
    echo          Abra o Docker Desktop na mao e rode este arquivo de novo.
    goto :erro
)
echo         Aguardando o Docker... ^(%ESPERA%s^)
goto :aguarda_docker

:docker_ok
echo         Docker pronto.

rem --- 2. Reconstroi a imagem com o codigo atual. O postinstall do
rem     ffmpeg-static baixa binario da internet, entao isto exige rede.
rem     Pode levar alguns minutos - e normal.
echo   [2/4] Reconstruindo a imagem (pode levar alguns minutos)...
docker compose build
if errorlevel 1 (
    echo   [ERRO] O "docker compose build" falhou. Log completo acima.
    goto :erro
)

rem --- 3. Sobe o container com a imagem nova. --force-recreate garante
rem     a troca mesmo que o Compose ache que nada mudou na definicao do
rem     servico (a imagem em si mudou, so isso ja exige recriar).
echo   [3/4] Subindo o container com a imagem nova...
docker compose %PERFIL% up -d --force-recreate
if errorlevel 1 (
    echo   [ERRO] O "docker compose up" falhou. Log completo:
    echo          docker compose logs
    goto :erro
)

rem --- 4. Sobe != pronto. O healthcheck do container consulta o banco;
rem     so depois de "(healthy)" a aplicacao responde de verdade.
rem     Obs: procurar por "(healthy)" com os parenteses e proposital -
rem     "(unhealthy)" nao casa com esse texto.
echo   [4/4] Aguardando a aplicacao responder...
set /a ESPERA=0

:aguarda_app
docker compose ps --format "{{.Status}}" | findstr /C:"(healthy)" >nul
if not errorlevel 1 goto :app_ok
docker compose ps --format "{{.Status}}" | findstr /C:"(unhealthy)" >nul
if not errorlevel 1 (
    echo   [ERRO] O container subiu mas o healthcheck falhou.
    echo          Quase sempre e o banco inacessivel. Veja:
    echo          docker compose logs --tail 30
    goto :erro
)
ping -n 3 127.0.0.1 >nul
set /a ESPERA+=2
if %ESPERA% geq 120 (
    echo   [ERRO] A aplicacao nao ficou pronta em 2 minutos.
    echo          docker compose logs --tail 30
    goto :erro
)
goto :aguarda_app

:app_ok
echo.
echo   ============================================
echo    Pronto. SSX Desk reiniciado com o codigo novo.
echo    %URL%
echo   ============================================
echo.
start "" "%URL%"
ping -n 3 127.0.0.1 >nul
exit /b 0

:erro
echo.
pause
exit /b 1
