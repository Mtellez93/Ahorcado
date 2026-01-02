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
    turno: "Wuachiturros", // Equipo que adivina
    equipoQuePonePalabra: "Chapisa", // Empieza Chapisa poniendo para que Wuachiturros adivine
    capitanes: { Wuachiturros: null, Chapisa: null },
    estado: "SETUP" 
};

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
        // Validación: Solo el equipo al que le toca puede iniciar la ronda
        if (data.equipo !== gameState.equipoQuePonePalabra) return;

        gameState.palabra = data.palabra.toUpperCase();
        gameState.vidasTotales = parseInt(data.vidas);
        gameState.letrasAdivinadas = [];
        gameState.errores = 0;
        gameState.estado = "JUGANDO";
        
        // El equipo que adivina es el opuesto al que puso la palabra
        gameState.turno = (gameState.equipoQuePonePalabra === "Wuachiturros") ? "Chapisa" : "Wuachiturros";
        
        io.emit('updateState', gameState);
    });

    socket.on('intentarLetra', (data) => {
        if (gameState.estado !== "JUGANDO" || data.equipo !== gameState.turno) return;
        const letra = data.letra.toUpperCase();
        if (!gameState.letrasAdivinadas.includes(letra)) {
            gameState.letrasAdivinadas.push(letra);
            if (!gameState.palabra.includes(letra)) gameState.errores++;
            validarFinal();
            io.emit('updateState', gameState);
        }
    });

    socket.on('nextRound', () => {
        // Alternamos automáticamente quién pone la palabra para la siguiente ronda
        gameState.equipoQuePonePalabra = (gameState.equipoQuePonePalabra === "Wuachiturros") ? "Chapisa" : "Wuachiturros";
        
        gameState.palabra = "";
        gameState.letrasAdivinadas = [];
        gameState.errores = 0;
        gameState.estado = "SETUP";
        io.emit('updateState', gameState);
    });

    socket.on('disconnect', () => {
        if (socket.id === gameState.capitanes.Wuachiturros) gameState.capitanes.Wuachiturros = null;
        if (socket.id === gameState.capitanes.Chapisa) gameState.capitanes.Chapisa = null;
    });
});

function validarFinal() {
    const ganaste = gameState.palabra.split('').every(l => gameState.letrasAdivinadas.includes(l));
    if (ganaste) gameState.estado = "GANO_" + gameState.turno;
    else if (gameState.errores >= gameState.vidasTotales) gameState.estado = "PERDIO_" + gameState.turno;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
