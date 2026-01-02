const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let gameState = {
    palabra: "",
    letrasAdivinadas: [],
    vidasTotales: 6,
    errores: 0,
    turno: "Wuachiturros",
    equipoQuePonePalabra: "Chapisa",
    capitanes: { Wuachiturros: null, Chapisa: null },
    estado: "SETUP",
    puntos: {
        Wuachiturros: { rondas: 0, adivinadas: 0 },
        Chapisa: { rondas: 0, adivinadas: 0 }
    },
    timer: 40
};

let timerInterval = null;

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

io.on('connection', (socket) => {
    socket.emit('updateState', gameState);

    socket.on('setRole', (equipo) => {
        if (!gameState.capitanes[equipo]) {
            gameState.capitanes[equipo] = socket.id;
            socket.emit('roleAssign', { role: 'capitan', equipo });
        } else {
            socket.emit('roleAssign', { role: 'jugador', equipo });
        }
    });

    socket.on('startGame', (data) => {
        if (data.equipo !== gameState.equipoQuePonePalabra) return;
        gameState.palabra = data.palabra.toUpperCase();
        gameState.vidasTotales = parseInt(data.vidas);
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
            gameState.timer = 40; // Reiniciar timer tras intento
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
        gameState.estado = "SETUP";
        gameState.equipoQuePonePalabra = "Chapisa";
        gameState.turno = "Wuachiturros";
        io.emit('updateState', gameState);
    });

    socket.on('disconnect', () => {
        if (socket.id === gameState.capitanes.Wuachiturros) gameState.capitanes.Wuachiturros = null;
        if (socket.id === gameState.capitanes.Chapisa) gameState.capitanes.Chapisa = null;
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
server.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
