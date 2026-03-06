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

const LOBBY_CODE = generarCodigoLobby();

let gameState = {
    palabra: "",
    letrasAdivinadas: [],
    vidasTotales: 6,
    errores: 0,
    turno: "Wuachiturros",
    equipoQuePonePalabra: "Chapisa",
    capitanes: { Wuachiturros: null, Chapisa: null },
    estado: "LOBBY",
    puntos: {
        Wuachiturros: { rondas: 0, adivinadas: 0 },
        Chapisa: { rondas: 0, adivinadas: 0 }
    },
    timer: 40,
    lobbyCode: LOBBY_CODE,
    playersByTeam: { Wuachiturros: 0, Chapisa: 0 },
    totalPlayers: 0,
    canStartMatch: false
};

let timerInterval = null;
const playerTeamBySocket = new Map();

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

    socket.on('setRole', ({ equipo, lobbyCode }) => {
        if (lobbyCode !== gameState.lobbyCode) {
            socket.emit('joinDenied', 'Código de lobby incorrecto.');
            return;
        }

        const previo = playerTeamBySocket.get(socket.id);
        if (previo) {
            if (gameState.capitanes[previo] === socket.id) gameState.capitanes[previo] = null;
        }

        playerTeamBySocket.set(socket.id, equipo);

        if (!gameState.capitanes[equipo]) {
            gameState.capitanes[equipo] = socket.id;
            socket.emit('roleAssign', { role: 'capitan', equipo });
        } else {
            socket.emit('roleAssign', { role: 'jugador', equipo });
        }

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
        stopTimer();
        gameState.puntos[gameState.turno].rondas += 1;
        gameState.equipoQuePonePalabra = (gameState.equipoQuePonePalabra === "Wuachiturros") ? "Chapisa" : "Wuachiturros";
        gameState.palabra = "";
        gameState.letrasAdivinadas = [];
        gameState.errores = 0;
        gameState.estado = "SETUP";
        io.emit('updateState', gameState);
    });

    socket.on('resetFullGame', () => {
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
        io.emit('updateState', gameState);
    });

    socket.on('disconnect', () => {
        const team = playerTeamBySocket.get(socket.id);
        playerTeamBySocket.delete(socket.id);
        if (socket.id === gameState.capitanes.Wuachiturros) gameState.capitanes.Wuachiturros = null;
        if (socket.id === gameState.capitanes.Chapisa) gameState.capitanes.Chapisa = null;

        if (team && !gameState.capitanes[team]) {
            const nuevoCapitan = [...playerTeamBySocket.entries()].find(([, t]) => t === team);
            if (nuevoCapitan) {
                gameState.capitanes[team] = nuevoCapitan[0];
                io.to(nuevoCapitan[0]).emit('roleAssign', { role: 'capitan', equipo: team });
            }
        }

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
server.listen(PORT, () => console.log(`Servidor en puerto ${PORT} | Lobby: ${LOBBY_CODE}`));
