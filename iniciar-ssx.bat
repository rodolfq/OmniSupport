@echo off
rem ============================================================
rem  SSX Desk - inicia o servidor em um clique.
rem
rem  Uso:  iniciar-ssx.bat          -> sobe so a aplicacao
rem        iniciar-ssx.bat tunel    -> sobe tambem o tunel Cloudflare
rem                                    (exige TUNNEL_TOKEN no .env)
rem
rem  chcp 65001 = pagina de codigo UTF-8, senao acento vira lixo no console.
rem ============================================================
chcp 65001 >nul
setlocal

set "PROJETO=%~dp0"
set "URL=http://localhost:3000"
set "PERFIL="
if /i "%~1"=="tunel" set "PERFIL=--profile tunnel"

title SSX Desk

echo.
echo   ============================================
echo    SSX Desk - iniciando
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
echo   [1/3] Verificando o Docker...
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

rem --- 2. Sobe o container. Se ja estiver rodando, o Compose nao faz nada,
rem     entao rodar este arquivo duas vezes e inofensivo.
echo   [2/3] Subindo o container...
docker compose %PERFIL% up -d
if errorlevel 1 (
    echo   [ERRO] O "docker compose up" falhou. Log completo:
    echo          docker compose logs
    goto :erro
)

rem --- 3. Sobe != pronto. O healthcheck do container consulta o banco;
rem     so depois de "(healthy)" a aplicacao responde de verdade.
rem     Obs: procurar por "(healthy)" com os parenteses e proposital -
rem     "(unhealthy)" nao casa com esse texto.
echo   [3/3] Aguardando a aplicacao responder...
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
echo    Pronto. SSX Desk no ar.
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
