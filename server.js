const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

function generarCodigoLobby() {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
}

let currentLobbyCode = generarCodigoLobby();

let gameState = {
    palabra: "",
    letrasAdivinadas: [],
    vidasTotales: 6,
    errores: 0,
    turno: "Wuachiturros",
    equipoQuePonePalabra: "Chapisa",
    estado: "LOBBY",
    puntos: {
        Wuachiturros: { rondas: 0, adivinadas: 0 },
        Chapisa: { rondas: 0, adivinadas: 0 }
    },
    timer: 40,
    lobbyCode: currentLobbyCode,
    playersByTeam: { Wuachiturros: 0, Chapisa: 0 },
    totalPlayers: 0,
    canStartMatch: false,
    matchResultMessage: ""
};

let timerInterval = null;
const playerTeamBySocket = new Map();
const MAX_RONDAS = 5;
const SESSION_GRACE_MS = 90000;
const playerSessions = new Map();
const sessionBySocket = new Map();

function reiniciarPartidaALobby() {
    stopTimer();
    gameState.puntos = {
        Wuachiturros: { rondas: 0, adivinadas: 0 },
        Chapisa: { rondas: 0, adivinadas: 0 }
    };
    gameState.palabra = "";
    gameState.letrasAdivinadas = [];
    gameState.errores = 0;
    gameState.estado = "LOBBY";
    gameState.equipoQuePonePalabra = "Chapisa";
    gameState.turno = "Wuachiturros";
    gameState.timer = 40;
    gameState.matchResultMessage = "";
    actualizarLobbyStatus();
}


function crearNuevoLobby() {
    stopTimer();
    currentLobbyCode = generarCodigoLobby();
    gameState.lobbyCode = currentLobbyCode;
    gameState.palabra = "";
    gameState.letrasAdivinadas = [];
    gameState.vidasTotales = 6;
    gameState.errores = 0;
    gameState.turno = "Wuachiturros";
    gameState.equipoQuePonePalabra = "Chapisa";
    gameState.estado = "LOBBY";
    gameState.timer = 40;
    gameState.matchResultMessage = "";

    playerTeamBySocket.clear();
    sessionBySocket.clear();
    for (const session of playerSessions.values()) {
        if (session.disconnectTimer) clearTimeout(session.disconnectTimer);
    }
    playerSessions.clear();

    actualizarLobbyStatus();
}

function jugadorValido(socket, equipo) {
    return playerTeamBySocket.get(socket.id) === equipo && sessionBySocket.has(socket.id);
}

function startTimer() {
    stopTimer();
    gameState.timer = 40;
    timerInterval = setInterval(() => {
        if (gameState.estado === "JUGANDO") {
            gameState.timer--;
            if (gameState.timer <= 0) {
                gameState.errores++;
                gameState.timer = 40;
                validarFinal();
            }
            io.emit('updateState', gameState);
        } else {
            stopTimer();
        }
    }, 1000);
}

function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
}

function actualizarLobbyStatus() {
    gameState.playersByTeam = {
        Wuachiturros: [...playerTeamBySocket.values()].filter(t => t === 'Wuachiturros').length,
        Chapisa: [...playerTeamBySocket.values()].filter(t => t === 'Chapisa').length
    };
    gameState.totalPlayers = playerTeamBySocket.size;
    gameState.canStartMatch = gameState.playersByTeam.Wuachiturros > 0 && gameState.playersByTeam.Chapisa > 0;
}

io.on('connection', (socket) => {
    actualizarLobbyStatus();
    socket.emit('updateState', gameState);

    socket.on('setRole', ({ equipo, lobbyCode, sessionId }) => {
        if (lobbyCode !== gameState.lobbyCode) {
            socket.emit('joinDenied', 'Código de lobby incorrecto.');
            return;
        }

        if (!sessionId) {
            socket.emit('joinDenied', 'Sesión inválida. Vuelve a unirte al lobby.');
            return;
        }

        const existingSession = playerSessions.get(sessionId);
        if (existingSession?.disconnectTimer) {
            clearTimeout(existingSession.disconnectTimer);
            existingSession.disconnectTimer = null;
        }

        if (existingSession?.socketId && existingSession.socketId !== socket.id) {
            playerTeamBySocket.delete(existingSession.socketId);
            sessionBySocket.delete(existingSession.socketId);
        }

        sessionBySocket.set(socket.id, sessionId);
        playerTeamBySocket.set(socket.id, equipo);

        if (existingSession) {
            existingSession.socketId = socket.id;
            existingSession.equipo = equipo;
        } else {
            playerSessions.set(sessionId, {
                socketId: socket.id,
                equipo,
                role: 'jugador',
                disconnectTimer: null
            });
        }

        playerSessions.get(sessionId).role = 'jugador';
        socket.emit('roleAssign', { role: 'jugador', equipo });

        actualizarLobbyStatus();
        io.emit('updateState', gameState);
    });

    socket.on('startMatch', () => {
        if (!gameState.canStartMatch || gameState.estado !== 'LOBBY') return;
        gameState.estado = 'SETUP';
        io.emit('updateState', gameState);
    });

    socket.on('startGame', (data) => {
        if (gameState.estado !== 'SETUP') return;
        if (!jugadorValido(socket, data.equipo)) return;
        if (data.equipo !== gameState.equipoQuePonePalabra) return;
        gameState.palabra = data.palabra.toUpperCase();
        gameState.vidasTotales = parseInt(data.vidas, 10);
        gameState.letrasAdivinadas = [];
        gameState.errores = 0;
        gameState.estado = "JUGANDO";
        gameState.turno = (gameState.equipoQuePonePalabra === "Wuachiturros") ? "Chapisa" : "Wuachiturros";
        startTimer();
        io.emit('updateState', gameState);
    });

    socket.on('intentarLetra', (data) => {
        if (gameState.estado !== "JUGANDO" || data.equipo !== gameState.turno) return;
        if (!jugadorValido(socket, data.equipo)) return;
        const letra = data.letra.toUpperCase();
        if (!gameState.letrasAdivinadas.includes(letra)) {
            gameState.letrasAdivinadas.push(letra);
            if (!gameState.palabra.includes(letra)) gameState.errores++;
            gameState.timer = 40;
            validarFinal();
            io.emit('updateState', gameState);
        }
    });

    socket.on('nextRound', () => {
        if (!jugadorValido(socket, playerTeamBySocket.get(socket.id))) return;
        stopTimer();
        gameState.puntos[gameState.turno].rondas += 1;

        const rondasJugadas = gameState.puntos.Wuachiturros.rondas + gameState.puntos.Chapisa.rondas;
        if (rondasJugadas >= MAX_RONDAS) {
            const exitosW = gameState.puntos.Wuachiturros.adivinadas;
            const exitosC = gameState.puntos.Chapisa.adivinadas;

            if (exitosW > exitosC) gameState.matchResultMessage = 'GANADOR: WUACHITURROS';
            else if (exitosC > exitosW) gameState.matchResultMessage = 'GANADOR: CHAPISA';
            else gameState.matchResultMessage = 'EMPATE';

            gameState.estado = 'MATCH_RESULT';
            io.emit('updateState', gameState);

            setTimeout(() => {
                reiniciarPartidaALobby();
                io.emit('updateState', gameState);
            }, 6000);
            return;
        }

        gameState.equipoQuePonePalabra = (gameState.equipoQuePonePalabra === "Wuachiturros") ? "Chapisa" : "Wuachiturros";
        gameState.palabra = "";
        gameState.letrasAdivinadas = [];
        gameState.errores = 0;
        gameState.estado = "SETUP";
        gameState.matchResultMessage = "";
        io.emit('updateState', gameState);
    });


    socket.on('createNewLobby', () => {
        crearNuevoLobby();
        io.emit('lobbyRecreated', { lobbyCode: gameState.lobbyCode });
        io.emit('updateState', gameState);
    });

    socket.on('resetFullGame', () => {
        reiniciarPartidaALobby();
        io.emit('updateState', gameState);
    });

    socket.on('disconnect', () => {
        const sessionId = sessionBySocket.get(socket.id);

        if (sessionId && playerSessions.has(sessionId)) {
            const session = playerSessions.get(sessionId);
            session.disconnectTimer = setTimeout(() => {
                const team = playerTeamBySocket.get(socket.id);
                playerTeamBySocket.delete(socket.id);
                sessionBySocket.delete(socket.id);
                playerSessions.delete(sessionId);

                actualizarLobbyStatus();
                io.emit('updateState', gameState);
            }, SESSION_GRACE_MS);
            return;
        }

        playerTeamBySocket.delete(socket.id);

        actualizarLobbyStatus();
        io.emit('updateState', gameState);
    });
});

function validarFinal() {
    const ganaste = gameState.palabra.split('').every(l => gameState.letrasAdivinadas.includes(l));
    if (ganaste) {
        gameState.estado = "GANO_" + gameState.turno;
        gameState.puntos[gameState.turno].adivinadas += 1;
        stopTimer();
    } else if (gameState.errores >= gameState.vidasTotales) {
        gameState.estado = "PERDIO_" + gameState.turno;
        stopTimer();
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor en puerto ${PORT} | Lobby: ${currentLobbyCode}`));
